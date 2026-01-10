from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.models import ProcessingStatus, QueueStateStatus

if TYPE_CHECKING:
    from ..database.models import Screenshot

logger = logging.getLogger(__name__)


class QueueService:
    @staticmethod
    async def get_next_screenshot(
        db: AsyncSession,
        user_id: int,
        group_id: str | None = None,
        processing_status: str | None = None,
        browse_mode: bool = False,
    ) -> Screenshot | None:
        """
        Get the next screenshot for annotation.

        MULTI-RATER DESIGN: All users see ALL screenshots. The queue only excludes:
        1. Screenshots this specific user has already annotated/verified
        2. Screenshots this specific user has explicitly skipped

        This ensures every rater can annotate every screenshot for cross-rater consensus.

        Args:
            db: Database session
            user_id: Current user ID
            group_id: Optional group filter
            processing_status: Optional processing status filter
            browse_mode: If True, allows browsing all screenshots including ones
                         the user has already annotated (for review purposes).
        """
        from ..database.models import Annotation, Screenshot, UserQueueState

        conditions = []

        # Exclude screenshots this user has already annotated (unless browse mode)
        if not browse_mode:
            subquery_user_annotations = (
                select(Annotation.screenshot_id).where(Annotation.user_id == user_id).scalar_subquery()
            )

            subquery_user_skipped = (
                select(UserQueueState.screenshot_id)
                .where(and_(UserQueueState.user_id == user_id, UserQueueState.status == QueueStateStatus.SKIPPED.value))
                .scalar_subquery()
            )

            # Only exclude what THIS user has done - other users' work doesn't affect the queue
            conditions.extend(
                [
                    Screenshot.id.notin_(subquery_user_annotations),
                    Screenshot.id.notin_(subquery_user_skipped),
                ]
            )

        # Add processing_status filter if provided, otherwise show all statuses
        if processing_status:
            conditions.append(Screenshot.processing_status == ProcessingStatus(processing_status))
        else:
            # Default: show all statuses
            conditions.append(
                Screenshot.processing_status.in_(
                    [
                        ProcessingStatus.PENDING,
                        ProcessingStatus.COMPLETED,
                        ProcessingStatus.FAILED,
                        ProcessingStatus.SKIPPED,
                    ]
                )
            )

        # Add group filter if provided
        if group_id:
            conditions.append(Screenshot.group_id == group_id)

        stmt = (
            select(Screenshot)
            .where(and_(*conditions))
            .order_by(
                Screenshot.processing_status.desc(),
                Screenshot.current_annotation_count.asc(),
                Screenshot.uploaded_at.asc(),
            )
            .limit(1)
        )

        result = await db.execute(stmt)
        screenshot = result.scalar_one_or_none()

        if screenshot:
            queue_state_stmt = select(UserQueueState).where(
                and_(
                    UserQueueState.user_id == user_id,
                    UserQueueState.screenshot_id == screenshot.id,
                )
            )
            queue_result = await db.execute(queue_state_stmt)
            existing_state = queue_result.scalars().first()  # Use first() to handle potential duplicates

            if not existing_state:
                try:
                    new_state = UserQueueState(
                        user_id=user_id, screenshot_id=screenshot.id, status=QueueStateStatus.PENDING.value
                    )
                    db.add(new_state)
                    await db.commit()
                except IntegrityError:
                    # Race condition: another request created the entry - this is expected, ignore
                    await db.rollback()
                except Exception as e:
                    # Unexpected error - log and rollback
                    logger.warning(f"Failed to create queue state: {e}")
                    await db.rollback()

        return screenshot

    @staticmethod
    async def get_disputed_screenshots(db: AsyncSession, user_id: int) -> list[Screenshot]:
        from ..database.models import Annotation, ConsensusResult, Screenshot

        subquery_user_annotations = (
            select(Annotation.screenshot_id).where(Annotation.user_id == user_id).scalar_subquery()
        )

        stmt = (
            select(Screenshot)
            .join(ConsensusResult)
            .where(
                and_(
                    ConsensusResult.has_consensus == False,  # noqa: E712 - SQLAlchemy requires ==
                    Screenshot.current_annotation_count < Screenshot.target_annotations,
                    Screenshot.id.notin_(subquery_user_annotations),
                )
            )
            .order_by(Screenshot.uploaded_at.asc())
        )

        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def mark_screenshot_skipped(db: AsyncSession, user_id: int, screenshot_id: int) -> None:
        from ..database.models import UserQueueState

        stmt = select(UserQueueState).where(
            and_(UserQueueState.user_id == user_id, UserQueueState.screenshot_id == screenshot_id)
        )
        result = await db.execute(stmt)
        existing_state = result.scalars().first()  # Use first() to handle potential duplicates

        if existing_state:
            existing_state.status = QueueStateStatus.SKIPPED.value
        else:
            new_state = UserQueueState(
                user_id=user_id, screenshot_id=screenshot_id, status=QueueStateStatus.SKIPPED.value
            )
            db.add(new_state)

        await db.commit()

    @staticmethod
    async def unskip_screenshot(db: AsyncSession, user_id: int, screenshot_id: int) -> bool:
        """
        Remove the skipped status from a screenshot for a specific user.

        Returns True if the screenshot was unskipped, False if it wasn't skipped.
        """
        from ..database.models import UserQueueState

        stmt = select(UserQueueState).where(
            and_(
                UserQueueState.user_id == user_id,
                UserQueueState.screenshot_id == screenshot_id,
                UserQueueState.status == QueueStateStatus.SKIPPED.value,
            )
        )
        result = await db.execute(stmt)
        existing_state = result.scalars().first()

        if existing_state:
            # Change status back to pending so it can appear in the user's queue again
            existing_state.status = QueueStateStatus.PENDING.value
            await db.commit()
            return True

        return False

    @staticmethod
    async def get_queue_stats(db: AsyncSession, user_id: int) -> dict:
        """
        Get queue statistics for a user.

        MULTI-RATER DESIGN: "remaining" = screenshots this user hasn't annotated yet.
        All users see all screenshots, so remaining count is per-user.
        """
        from ..database.models import Annotation, Screenshot, UserQueueState

        subquery_user_annotations = (
            select(Annotation.screenshot_id).where(Annotation.user_id == user_id).scalar_subquery()
        )

        subquery_user_skipped = (
            select(UserQueueState.screenshot_id)
            .where(and_(UserQueueState.user_id == user_id, UserQueueState.status == QueueStateStatus.SKIPPED.value))
            .scalar_subquery()
        )

        # Count screenshots this user hasn't annotated yet (excluding deleted)
        total_remaining_stmt = select(func.count(Screenshot.id)).where(
            and_(
                Screenshot.processing_status.in_(
                    [
                        ProcessingStatus.PENDING,
                        ProcessingStatus.COMPLETED,
                        ProcessingStatus.FAILED,
                        ProcessingStatus.SKIPPED,
                    ]
                ),
                Screenshot.id.notin_(subquery_user_annotations),
                Screenshot.id.notin_(subquery_user_skipped),
            )
        )

        result = await db.execute(total_remaining_stmt)
        total_remaining = result.scalar_one()

        user_completed_stmt = select(func.count(Annotation.id)).where(Annotation.user_id == user_id)
        result = await db.execute(user_completed_stmt)
        user_completed = result.scalar_one()

        auto_processed_stmt = select(func.count(Screenshot.id)).where(
            Screenshot.processing_status == ProcessingStatus.COMPLETED
        )
        result = await db.execute(auto_processed_stmt)
        auto_processed = result.scalar_one()

        pending_stmt = select(func.count(Screenshot.id)).where(Screenshot.processing_status == ProcessingStatus.PENDING)
        result = await db.execute(pending_stmt)
        pending = result.scalar_one()

        failed_stmt = select(func.count(Screenshot.id)).where(Screenshot.processing_status == ProcessingStatus.FAILED)
        result = await db.execute(failed_stmt)
        failed = result.scalar_one()

        skipped_stmt = select(func.count(Screenshot.id)).where(Screenshot.processing_status == ProcessingStatus.SKIPPED)
        result = await db.execute(skipped_stmt)
        skipped = result.scalar_one()

        return {
            "total_remaining": total_remaining,
            "user_completed": user_completed,
            "auto_processed": auto_processed,
            "pending": pending,
            "failed": failed,
            "skipped": skipped,
        }
