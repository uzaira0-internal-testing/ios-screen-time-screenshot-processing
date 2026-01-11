"""Repository for Screenshot database operations.

This module extracts database queries from routes into a dedicated class,
providing a clean separation between HTTP handling and data access.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from sqlalchemy import String, and_, case, cast, extract, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from screenshot_processor.web.database import (
    Annotation,
    AnnotationStatus,
    ConsensusResult,
    Group,
    GroupRead,
    ProcessingStatus,
    Screenshot,
    ScreenshotRead,
    User,
)


@dataclass
class ScreenshotStats:
    """Statistics about screenshots in the system."""

    total: int
    pending_annotation: int
    completed_annotation: int
    pending_processing: int
    auto_processed: int
    failed: int
    skipped: int
    total_annotations: int
    with_consensus: int
    with_disagreements: int
    users_active: int


@dataclass
class PaginatedResult:
    """Result of a paginated query."""

    items: list[Screenshot]
    total: int
    has_next: bool
    has_prev: bool


class ScreenshotRepository:
    """Repository for Screenshot database operations.

    This class encapsulates all database queries related to screenshots,
    providing a clean interface for the route handlers.

    Usage:
        repo = ScreenshotRepository(db)
        screenshot = await repo.get_by_id(123)
        screenshots = await repo.list_with_filters(group_id="abc", page=1)
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, screenshot_id: int) -> Screenshot | None:
        """Get a screenshot by ID.

        Returns None if not found (caller decides whether to raise 404).
        """
        result = await self.db.execute(
            select(Screenshot).where(Screenshot.id == screenshot_id)
        )
        return result.scalar_one_or_none()

    async def get_by_id_for_update(self, screenshot_id: int) -> Screenshot | None:
        """Get a screenshot with row lock for safe concurrent updates.

        Use this when modifying fields that could be updated concurrently
        (e.g., verified_by_user_ids, annotation counts).
        """
        result = await self.db.execute(
            select(Screenshot)
            .where(Screenshot.id == screenshot_id)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def get_usernames_for_ids(self, user_ids: Sequence[int]) -> dict[int, str]:
        """Get username mapping for a list of user IDs.

        Returns a dict mapping user_id -> username.
        """
        if not user_ids:
            return {}

        result = await self.db.execute(
            select(User.id, User.username).where(User.id.in_(user_ids))
        )
        return {row.id: row.username for row in result.all()}

    async def enrich_with_usernames(
        self, screenshot: Screenshot
    ) -> ScreenshotRead:
        """Convert Screenshot to ScreenshotRead with verified_by_usernames populated."""
        data = ScreenshotRead.model_validate(screenshot)

        if screenshot.verified_by_user_ids:
            user_map = await self.get_usernames_for_ids(screenshot.verified_by_user_ids)
            data.verified_by_usernames = [
                user_map.get(uid, f"User {uid}")
                for uid in screenshot.verified_by_user_ids
            ]

        return data

    async def enrich_many_with_usernames(
        self, screenshots: Sequence[Screenshot]
    ) -> list[ScreenshotRead]:
        """Convert list of Screenshots to ScreenshotRead with usernames populated."""
        if not screenshots:
            return []

        # Collect all unique user IDs
        all_user_ids: set[int] = set()
        for s in screenshots:
            if s.verified_by_user_ids:
                all_user_ids.update(s.verified_by_user_ids)

        # Fetch all usernames in one query
        user_map = await self.get_usernames_for_ids(list(all_user_ids))

        # Enrich each screenshot
        enriched = []
        for s in screenshots:
            data = ScreenshotRead.model_validate(s)
            if s.verified_by_user_ids:
                data.verified_by_usernames = [
                    user_map.get(uid, f"User {uid}")
                    for uid in s.verified_by_user_ids
                ]
            enriched.append(data)

        return enriched

    async def list_with_filters(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        group_id: str | None = None,
        processing_status: str | None = None,
        verified_by_me: bool | None = None,
        verified_by_others: bool | None = None,
        current_user_id: int | None = None,
        search: str | None = None,
        sort_by: str = "id",
        sort_order: str = "asc",
    ) -> PaginatedResult:
        """List screenshots with comprehensive filtering and pagination.

        Args:
            page: Page number (1-indexed)
            page_size: Items per page
            group_id: Filter by group ID
            processing_status: Filter by processing status
            verified_by_me: Filter by current user's verification (True=verified by me, False=not verified by me).
                            Requires current_user_id to be set.
            verified_by_others: Filter for screenshots verified by others but not current user (True only).
                            Requires current_user_id to be set.
            current_user_id: The current user's ID for user-specific filtering
            search: Search by ID, participant_id, or extracted_title
            sort_by: Sort field (id, uploaded_at, processing_status)
            sort_order: Sort direction (asc, desc)

        Returns:
            PaginatedResult with items, total count, and pagination info
        """
        from sqlalchemy import literal

        stmt = select(Screenshot)
        count_stmt = select(func.count(Screenshot.id))

        conditions = []

        # Group filter
        if group_id:
            conditions.append(Screenshot.group_id == group_id)

        # Processing status filter
        if processing_status:
            conditions.append(Screenshot.processing_status == processing_status)

        # Helper to check if user ID is in verified_by_user_ids array
        # Column is JSON type, need to cast both sides to JSONB for @> operator
        from sqlalchemy.dialects.postgresql import JSONB
        def user_in_verified_list(user_id: int):
            return cast(Screenshot.verified_by_user_ids, JSONB).op("@>")(
                cast(literal(f"[{user_id}]"), JSONB)
            )

        def has_verifications():
            return and_(
                Screenshot.verified_by_user_ids.isnot(None),
                cast(Screenshot.verified_by_user_ids, String) != "null",
                cast(Screenshot.verified_by_user_ids, String) != "[]",
            )

        # User-specific verified filter
        if verified_by_me is not None and current_user_id is not None:
            if verified_by_me is True:
                # Verified BY ME: my user ID is in the verified_by_user_ids array
                conditions.append(user_in_verified_list(current_user_id))
            else:
                # NOT verified by me: my user ID is NOT in the array (or array is null/empty)
                conditions.append(
                    or_(
                        ~has_verifications(),
                        ~user_in_verified_list(current_user_id),
                    )
                )

        # Verified by others filter (verified by someone, but not by current user)
        if verified_by_others is True and current_user_id is not None:
            # Has verifications AND current user is NOT in the list
            conditions.append(has_verifications())
            conditions.append(~user_in_verified_list(current_user_id))

        # Search filter
        if search:
            search_term = f"%{search}%"
            conditions.append(
                or_(
                    cast(Screenshot.id, String).like(search_term),
                    Screenshot.participant_id.ilike(search_term),
                    Screenshot.extracted_title.ilike(search_term),
                )
            )

        # Apply conditions
        if conditions:
            stmt = stmt.where(and_(*conditions))
            count_stmt = count_stmt.where(and_(*conditions))

        # Get total count
        result = await self.db.execute(count_stmt)
        total = result.scalar_one()

        # Sorting
        sort_column = Screenshot.id
        if sort_by == "uploaded_at":
            sort_column = Screenshot.uploaded_at
        elif sort_by == "processing_status":
            sort_column = Screenshot.processing_status

        if sort_order == "desc":
            stmt = stmt.order_by(sort_column.desc())
        else:
            stmt = stmt.order_by(sort_column.asc())

        # Pagination
        offset = (page - 1) * page_size
        stmt = stmt.offset(offset).limit(page_size)

        result = await self.db.execute(stmt)
        screenshots = list(result.scalars().all())

        return PaginatedResult(
            items=screenshots,
            total=total,
            has_next=offset + len(screenshots) < total,
            has_prev=page > 1,
        )

    async def get_stats(self) -> ScreenshotStats:
        """Get comprehensive screenshot statistics.

        Uses conditional aggregation to minimize database round trips.
        """
        # Query 1: Screenshot stats using conditional aggregation
        screenshot_stats_stmt = select(
            func.count(Screenshot.id).label("total"),
            func.count(
                case(
                    (
                        and_(
                            Screenshot.annotation_status == AnnotationStatus.PENDING,
                            
                        ),
                        1,
                    )
                )
            ).label("pending_annotation"),
            func.count(
                case(
                    (
                        and_(
                            Screenshot.current_annotation_count
                            >= Screenshot.target_annotations,
                            
                        ),
                        1,
                    )
                )
            ).label("completed_annotation"),
            func.count(
                case((Screenshot.processing_status == ProcessingStatus.PENDING, 1))
            ).label("pending_processing"),
            func.count(
                case((Screenshot.processing_status == ProcessingStatus.COMPLETED, 1))
            ).label("auto_processed"),
            func.count(
                case((Screenshot.processing_status == ProcessingStatus.FAILED, 1))
            ).label("failed"),
            func.count(
                case((Screenshot.processing_status == ProcessingStatus.SKIPPED, 1))
            ).label("skipped"),
        )
        result = await self.db.execute(screenshot_stats_stmt)
        screenshot_stats = result.one()

        # Query 2: Annotation count
        annotation_count_stmt = select(func.count(Annotation.id))
        result = await self.db.execute(annotation_count_stmt)
        total_annotations = result.scalar_one()

        # Query 3: Consensus stats
        consensus_stats_stmt = select(
            func.count(
                case((ConsensusResult.has_consensus == True, 1))  # noqa: E712
            ).label("with_consensus"),
            func.count(
                case((ConsensusResult.has_consensus == False, 1))  # noqa: E712
            ).label("with_disagreements"),
        )
        result = await self.db.execute(consensus_stats_stmt)
        consensus_stats = result.one()

        # Query 4: Active users
        users_active_stmt = select(func.count(User.id)).where(
            User.is_active == True  # noqa: E712
        )
        result = await self.db.execute(users_active_stmt)
        users_active = result.scalar_one()

        return ScreenshotStats(
            total=screenshot_stats.total,
            pending_annotation=screenshot_stats.pending_annotation,
            completed_annotation=screenshot_stats.completed_annotation,
            pending_processing=screenshot_stats.pending_processing,
            auto_processed=screenshot_stats.auto_processed,
            failed=screenshot_stats.failed,
            skipped=screenshot_stats.skipped,
            total_annotations=total_annotations,
            with_consensus=consensus_stats.with_consensus,
            with_disagreements=consensus_stats.with_disagreements,
            users_active=users_active,
        )

    async def list_groups(self) -> list[GroupRead]:
        """List all groups with screenshot counts by processing status."""
        # Compute processing time in seconds: processed_at - processing_started_at
        processing_time_expr = extract(
            "epoch",
            Screenshot.processed_at - Screenshot.processing_started_at
        )
        # Only count processing time for screenshots that have both timestamps
        valid_time_case = case(
            (
                and_(
                    Screenshot.processing_started_at.isnot(None),
                    Screenshot.processed_at.isnot(None),
                ),
                processing_time_expr,
            ),
            else_=None,
        )

        stmt = (
            select(
                Group,
                func.count(Screenshot.id).label("total_count"),
                func.count(
                    case((Screenshot.processing_status == ProcessingStatus.PENDING, 1))
                ).label("pending"),
                func.count(
                    case((Screenshot.processing_status == ProcessingStatus.COMPLETED, 1))
                ).label("completed"),
                func.count(
                    case((Screenshot.processing_status == ProcessingStatus.FAILED, 1))
                ).label("failed"),
                func.count(
                    case((Screenshot.processing_status == ProcessingStatus.SKIPPED, 1))
                ).label("skipped"),
                # Processing time metrics
                func.sum(valid_time_case).label("total_processing_time"),
                func.avg(valid_time_case).label("avg_processing_time"),
                func.min(valid_time_case).label("min_processing_time"),
                func.max(valid_time_case).label("max_processing_time"),
            )
            .outerjoin(Screenshot, Screenshot.group_id == Group.id)
            .group_by(Group.id)
        )
        result = await self.db.execute(stmt)
        rows = result.all()

        return [
            GroupRead(
                id=row.Group.id,
                name=row.Group.name,
                image_type=row.Group.image_type,
                created_at=row.Group.created_at,
                screenshot_count=row.total_count,
                processing_pending=row.pending,
                processing_completed=row.completed,
                processing_failed=row.failed,
                processing_skipped=row.skipped,
                total_processing_time_seconds=float(row.total_processing_time) if row.total_processing_time else None,
                avg_processing_time_seconds=float(row.avg_processing_time) if row.avg_processing_time else None,
                min_processing_time_seconds=float(row.min_processing_time) if row.min_processing_time else None,
                max_processing_time_seconds=float(row.max_processing_time) if row.max_processing_time else None,
            )
            for row in rows
        ]

    async def get_group(self, group_id: str) -> GroupRead | None:
        """Get a single group by ID with screenshot counts."""
        # Compute processing time in seconds: processed_at - processing_started_at
        processing_time_expr = extract(
            "epoch",
            Screenshot.processed_at - Screenshot.processing_started_at
        )
        # Only count processing time for screenshots that have both timestamps
        valid_time_case = case(
            (
                and_(
                    Screenshot.processing_started_at.isnot(None),
                    Screenshot.processed_at.isnot(None),
                ),
                processing_time_expr,
            ),
            else_=None,
        )

        stmt = (
            select(
                Group,
                func.count(Screenshot.id).label("total_count"),
                func.count(
                    case((Screenshot.processing_status == ProcessingStatus.PENDING, 1))
                ).label("pending"),
                func.count(
                    case((Screenshot.processing_status == ProcessingStatus.COMPLETED, 1))
                ).label("completed"),
                func.count(
                    case((Screenshot.processing_status == ProcessingStatus.FAILED, 1))
                ).label("failed"),
                func.count(
                    case((Screenshot.processing_status == ProcessingStatus.SKIPPED, 1))
                ).label("skipped"),
                # Processing time metrics
                func.sum(valid_time_case).label("total_processing_time"),
                func.avg(valid_time_case).label("avg_processing_time"),
                func.min(valid_time_case).label("min_processing_time"),
                func.max(valid_time_case).label("max_processing_time"),
            )
            .outerjoin(Screenshot, Screenshot.group_id == Group.id)
            .where(Group.id == group_id)
            .group_by(Group.id)
        )
        result = await self.db.execute(stmt)
        row = result.one_or_none()

        if not row:
            return None

        return GroupRead(
            id=row.Group.id,
            name=row.Group.name,
            image_type=row.Group.image_type,
            created_at=row.Group.created_at,
            screenshot_count=row.total_count,
            processing_pending=row.pending,
            processing_completed=row.completed,
            processing_failed=row.failed,
            processing_skipped=row.skipped,
            total_processing_time_seconds=float(row.total_processing_time) if row.total_processing_time else None,
            avg_processing_time_seconds=float(row.avg_processing_time) if row.avg_processing_time else None,
            min_processing_time_seconds=float(row.min_processing_time) if row.min_processing_time else None,
            max_processing_time_seconds=float(row.max_processing_time) if row.max_processing_time else None,
        )

    async def get_annotation_count(self, screenshot_id: int) -> int:
        """Get the number of annotations for a screenshot."""
        stmt = select(func.count(Annotation.id)).where(
            Annotation.screenshot_id == screenshot_id
        )
        result = await self.db.execute(stmt)
        return result.scalar_one()

    async def update(
        self, screenshot: Screenshot, **fields: object
    ) -> Screenshot:
        """Update screenshot fields and commit.

        Args:
            screenshot: The screenshot to update
            **fields: Fields to update

        Returns:
            Updated screenshot
        """
        for field, value in fields.items():
            setattr(screenshot, field, value)

        await self.db.commit()
        await self.db.refresh(screenshot)
        return screenshot

    async def find_potential_duplicate(
        self, screenshot: Screenshot
    ) -> int | None:
        """Find a potential semantic duplicate of this screenshot.

        A duplicate is another screenshot with the same:
        - participant_id
        - screenshot_date
        - extracted_title
        - extracted_total

        Returns the ID of the first matching screenshot, or None if no duplicate.
        Only checks completed/skipped screenshots (not pending/failed).
        """
        # Need all 4 fields to have values to check for duplicates
        if not all([
            screenshot.participant_id,
            screenshot.screenshot_date,
            screenshot.extracted_title,
            screenshot.extracted_total,
        ]):
            return None

        stmt = (
            select(Screenshot.id)
            .where(
                and_(
                    Screenshot.id != screenshot.id,
                    Screenshot.participant_id == screenshot.participant_id,
                    Screenshot.screenshot_date == screenshot.screenshot_date,
                    Screenshot.extracted_title == screenshot.extracted_title,
                    Screenshot.extracted_total == screenshot.extracted_total,
                    Screenshot.processing_status.in_([
                        ProcessingStatus.COMPLETED,
                        ProcessingStatus.SKIPPED,
                    ]),
                )
            )
            .order_by(Screenshot.id.asc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        duplicate_id = result.scalar_one_or_none()
        return duplicate_id
