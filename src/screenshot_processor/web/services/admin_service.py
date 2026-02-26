"""Admin operations service.

Extracts admin business logic from routes into a testable service layer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from screenshot_processor.core.image_utils import convert_dark_mode
from screenshot_processor.core.ocr import find_screenshot_total_usage
from screenshot_processor.web.database.models import (
    Annotation,
    AnnotationStatus,
    Group,
    Screenshot,
    User,
    UserQueueState,
)

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


@dataclass
class UserStats:
    """User with annotation statistics."""

    user: User
    annotations_count: int
    avg_time_spent_seconds: float


@dataclass
class DeleteGroupResult:
    """Result of group deletion."""

    success: bool
    group_id: str
    screenshots_deleted: int
    annotations_deleted: int
    message: str


@dataclass
class RecalculateOcrResult:
    """Result of OCR total recalculation."""

    success: bool
    total_missing: int
    processed: int
    updated: int
    failed: int
    message: str


class AdminService:
    """Service for admin operations.

    Handles:
    - User management and statistics
    - Test data reset
    - Group deletion
    - Bulk OCR recalculation
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # User Management
    # =========================================================================

    async def get_all_users_with_stats(self) -> list[UserStats]:
        """Get all users with their annotation statistics."""
        stmt = (
            select(
                User,
                func.count(Annotation.id).label("annotations_count"),
                func.coalesce(func.avg(Annotation.time_spent_seconds), 0).label("avg_time"),
            )
            .outerjoin(Annotation, Annotation.user_id == User.id)
            .group_by(User.id)
            .order_by(User.created_at.desc())
        )
        result = await self.db.execute(stmt)
        rows = result.all()

        return [
            UserStats(
                user=row.User,
                annotations_count=row.annotations_count,
                avg_time_spent_seconds=round(float(row.avg_time), 2),
            )
            for row in rows
        ]

    async def get_user_by_id(self, user_id: int) -> User | None:
        """Get user by ID."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def update_user(
        self,
        user: User,
        is_active: bool | None = None,
        role: str | None = None,
    ) -> User:
        """Update user attributes."""
        if is_active is not None:
            user.is_active = is_active

        if role is not None:
            if role not in ["annotator", "admin"]:
                raise ValueError("Invalid role")
            user.role = role

        await self.db.commit()
        await self.db.refresh(user)
        return user

    # =========================================================================
    # Test Data Reset
    # =========================================================================

    async def reset_test_data(self) -> None:
        """Reset all test data for e2e testing."""
        # Clear all user queue states
        await self.db.execute(delete(UserQueueState))

        # Clear all annotations
        await self.db.execute(delete(Annotation))

        # Reset screenshot annotation counts
        result = await self.db.execute(select(Screenshot))
        screenshots = result.scalars().all()
        for screenshot in screenshots:
            screenshot.current_annotation_count = 0
            screenshot.annotation_status = AnnotationStatus.PENDING
            screenshot.has_consensus = False
            screenshot.verified_by_user_ids = None

        await self.db.commit()

    # =========================================================================
    # Group Management
    # =========================================================================

    async def get_group_by_id(self, group_id: str) -> Group | None:
        """Get group by ID."""
        result = await self.db.execute(select(Group).where(Group.id == group_id))
        return result.scalar_one_or_none()

    async def delete_group(self, group_id: str) -> DeleteGroupResult:
        """Delete a group and all its screenshots (hard delete)."""
        # Check if group exists
        group = await self.get_group_by_id(group_id)
        if not group:
            raise ValueError(f"Group '{group_id}' not found")

        # Get all screenshot IDs in this group
        screenshots_result = await self.db.execute(
            select(Screenshot.id).where(Screenshot.group_id == group_id)
        )
        screenshot_ids = [row[0] for row in screenshots_result.fetchall()]

        screenshots_count = len(screenshot_ids)
        annotations_count = 0

        if screenshot_ids:
            # Delete all annotations for these screenshots
            annotations_result = await self.db.execute(
                delete(Annotation).where(Annotation.screenshot_id.in_(screenshot_ids))
            )
            annotations_count = annotations_result.rowcount

            # Delete all screenshots in this group
            await self.db.execute(delete(Screenshot).where(Screenshot.group_id == group_id))

        # Delete the group itself
        await self.db.execute(delete(Group).where(Group.id == group_id))

        await self.db.commit()

        return DeleteGroupResult(
            success=True,
            group_id=group_id,
            screenshots_deleted=screenshots_count,
            annotations_deleted=annotations_count,
            message=f"Group '{group_id}' deleted successfully",
        )

    # =========================================================================
    # OCR Recalculation
    # =========================================================================

    async def recalculate_ocr_totals(
        self,
        limit: int = 100,
        group_id: str | None = None,
    ) -> RecalculateOcrResult:
        """Recalculate OCR totals for screenshots missing extracted_total."""
        # Find screenshots missing extracted_total
        query = select(Screenshot).where(
            Screenshot.image_type == "screen_time",
            or_(
                Screenshot.extracted_total.is_(None),
                Screenshot.extracted_total == "",
            ),
        )

        if group_id:
            query = query.where(Screenshot.group_id == group_id)

        query = query.limit(limit)

        result = await self.db.execute(query)
        screenshots = result.scalars().all()

        total_missing = len(screenshots)
        processed = 0
        updated = 0
        failed = 0

        for screenshot in screenshots:
            processed += 1
            try:
                file_path = screenshot.file_path
                if not Path(file_path).exists():
                    logger.warning("Screenshot file not found", extra={"screenshot_id": screenshot.id, "file_path": file_path})
                    failed += 1
                    continue

                img = cv2.imread(file_path)
                if img is None:
                    logger.warning("Could not read screenshot image", extra={"screenshot_id": screenshot.id, "file_path": file_path})
                    failed += 1
                    continue

                img = convert_dark_mode(img)
                total, _ = find_screenshot_total_usage(img)

                if total and total.strip():
                    screenshot.extracted_total = total.strip()
                    updated += 1
                    logger.info("Extracted OCR total", extra={"screenshot_id": screenshot.id, "extracted_total": total.strip()})
                else:
                    logger.info("No OCR total found", extra={"screenshot_id": screenshot.id})

            except Exception as e:
                logger.error("Error extracting OCR total", extra={"screenshot_id": screenshot.id, "error": str(e)})
                failed += 1

        await self.db.commit()

        return RecalculateOcrResult(
            success=True,
            total_missing=total_missing,
            processed=processed,
            updated=updated,
            failed=failed,
            message=f"Processed {processed} screenshots: {updated} updated, {failed} failed",
        )

    # =========================================================================
    # Bulk Reprocess
    # =========================================================================

    async def get_screenshot_ids_for_reprocess(
        self,
        group_id: str | None = None,
        limit: int = 1000,
    ) -> list[int]:
        """Get screenshot IDs that need reprocessing."""
        query = select(Screenshot.id).where(
            Screenshot.image_type == "screen_time",
        )

        if group_id:
            query = query.where(Screenshot.group_id == group_id)

        query = query.limit(limit)

        result = await self.db.execute(query)
        return [row[0] for row in result.fetchall()]
