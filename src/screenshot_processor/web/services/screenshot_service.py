"""Screenshot business logic service.

Extracts business logic from routes into a testable service layer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from screenshot_processor.core.image_utils import convert_dark_mode
from screenshot_processor.core.ocr import find_screenshot_total_usage
from screenshot_processor.web.database.models import Screenshot
from screenshot_processor.web.repositories import ScreenshotRepository

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


@dataclass
class NavigationResult:
    """Result of navigation query."""

    screenshot: Screenshot | None
    current_index: int
    total_in_filter: int
    has_next: bool
    has_prev: bool


class ScreenshotService:
    """Service for screenshot business operations.

    Handles:
    - OCR extraction/recalculation
    - Verification workflow
    - Soft delete/restore
    - Navigation with filters
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = ScreenshotRepository(db)

    # =========================================================================
    # OCR Operations
    # =========================================================================

    async def ensure_ocr_total(self, screenshot: Screenshot) -> bool:
        """Extract and save OCR total if screenshot is missing it.

        Only applies to screen_time type screenshots.
        Returns True if total was extracted.
        """
        # Never modify verified screenshots
        if screenshot.verified_by_user_ids and len(screenshot.verified_by_user_ids) > 0:
            return False

        if screenshot.image_type != "screen_time":
            return False

        if screenshot.extracted_total and screenshot.extracted_total.strip():
            return False

        try:
            file_path = screenshot.file_path
            if not Path(file_path).exists():
                logger.warning(f"Screenshot {screenshot.id}: File not found at {file_path}")
                return False

            img = cv2.imread(file_path)
            if img is None:
                logger.warning(f"Screenshot {screenshot.id}: Could not read image at {file_path}")
                return False

            img = convert_dark_mode(img)
            total, _ = find_screenshot_total_usage(img)

            if total and total.strip():
                screenshot.extracted_total = total.strip()
                await self.db.commit()
                logger.info(f"Screenshot {screenshot.id}: Auto-extracted OCR total = '{total.strip()}'")
                return True

        except Exception as e:
            logger.error(f"Screenshot {screenshot.id}: Error auto-extracting OCR total - {e}")

        return False

    async def recalculate_ocr_total(self, screenshot: Screenshot) -> tuple[bool, str | None, str]:
        """Recalculate OCR total for a screenshot.

        Returns (success, extracted_total, message).
        """
        if screenshot.image_type != "screen_time":
            return False, None, "OCR recalculation only applies to screen_time screenshots"

        try:
            file_path = screenshot.file_path
            if not Path(file_path).exists():
                return False, None, f"Image file not found at {file_path}"

            img = cv2.imread(file_path)
            if img is None:
                return False, None, "Could not read image file"

            img = convert_dark_mode(img)
            total, _ = find_screenshot_total_usage(img)

            if total and total.strip():
                screenshot.extracted_total = total.strip()
                await self.db.commit()
                await self.db.refresh(screenshot)
                logger.info(f"Screenshot {screenshot.id}: Recalculated OCR total = '{total.strip()}'")
                return True, total.strip(), "OCR total recalculated successfully"
            else:
                return False, None, "No total found in image"

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Screenshot {screenshot.id}: Error recalculating OCR total - {e}")
            raise

    # =========================================================================
    # Verification Workflow
    # =========================================================================

    async def verify_screenshot(
        self,
        screenshot: Screenshot,
        user_id: int,
        grid_coords: dict | None = None,
    ) -> Screenshot:
        """Mark screenshot as verified by user.

        Args:
            screenshot: Screenshot to verify (should be locked for update)
            user_id: ID of verifying user
            grid_coords: Optional grid coordinates to freeze at verification time
        """
        verified_ids = list(screenshot.verified_by_user_ids or [])

        if user_id not in verified_ids:
            verified_ids.append(user_id)
            screenshot.verified_by_user_ids = verified_ids
            flag_modified(screenshot, "verified_by_user_ids")

        # Save grid coordinates if provided
        if grid_coords:
            if grid_coords.get("upper_left_x") is not None:
                screenshot.grid_upper_left_x = grid_coords["upper_left_x"]
            if grid_coords.get("upper_left_y") is not None:
                screenshot.grid_upper_left_y = grid_coords["upper_left_y"]
            if grid_coords.get("lower_right_x") is not None:
                screenshot.grid_lower_right_x = grid_coords["lower_right_x"]
            if grid_coords.get("lower_right_y") is not None:
                screenshot.grid_lower_right_y = grid_coords["lower_right_y"]

        await self.db.commit()
        await self.db.refresh(screenshot)
        return screenshot

    async def unverify_screenshot(self, screenshot: Screenshot, user_id: int) -> Screenshot:
        """Remove verification mark from screenshot for user.

        Args:
            screenshot: Screenshot to unverify (should be locked for update)
            user_id: ID of user to remove verification for
        """
        verified_ids = list(screenshot.verified_by_user_ids or [])

        if user_id in verified_ids:
            verified_ids.remove(user_id)
            screenshot.verified_by_user_ids = verified_ids if verified_ids else None
            flag_modified(screenshot, "verified_by_user_ids")
            await self.db.commit()
            await self.db.refresh(screenshot)

        return screenshot

    # =========================================================================
    # Navigation
    # =========================================================================

    async def navigate(
        self,
        screenshot_id: int,
        direction: str = "current",
        group_id: str | None = None,
        processing_status: str | None = None,
        verified_by_me: bool | None = None,
    ) -> NavigationResult:
        """Get screenshot with navigation context within filtered results.

        Args:
            screenshot_id: Current screenshot ID
            direction: "current", "next", or "prev"
            group_id: Optional group filter
            processing_status: Optional status filter
            verified_by_me: Optional verification filter
        """
        # Build filter conditions
        conditions = []
        if group_id:
            conditions.append(Screenshot.group_id == group_id)
        if processing_status:
            conditions.append(Screenshot.processing_status == processing_status)
        if verified_by_me is True:
            # Note: JSON columns can have SQL NULL or JSON null (literal "null" string)
            conditions.append(Screenshot.verified_by_user_ids.isnot(None))
            conditions.append(cast(Screenshot.verified_by_user_ids, String) != "null")
            conditions.append(cast(Screenshot.verified_by_user_ids, String) != "[]")
        elif verified_by_me is False:
            conditions.append(
                or_(
                    Screenshot.verified_by_user_ids.is_(None),
                    cast(Screenshot.verified_by_user_ids, String) == "null",
                    cast(Screenshot.verified_by_user_ids, String) == "[]",
                )
            )

        # Get total count
        count_stmt = select(func.count(Screenshot.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        result = await self.db.execute(count_stmt)
        total_in_filter = result.scalar_one()

        # Get target screenshot based on direction
        if direction == "next":
            stmt = select(Screenshot).where(Screenshot.id > screenshot_id)
            if conditions:
                stmt = stmt.where(and_(*conditions))
            stmt = stmt.order_by(Screenshot.id.asc()).limit(1)
        elif direction == "prev":
            stmt = select(Screenshot).where(Screenshot.id < screenshot_id)
            if conditions:
                stmt = stmt.where(and_(*conditions))
            stmt = stmt.order_by(Screenshot.id.desc()).limit(1)
        else:
            stmt = select(Screenshot).where(Screenshot.id == screenshot_id)
            if conditions:
                stmt = stmt.where(and_(*conditions))

        result = await self.db.execute(stmt)
        screenshot = result.scalar_one_or_none()

        if not screenshot:
            return NavigationResult(
                screenshot=None,
                current_index=0,
                total_in_filter=total_in_filter,
                has_next=False,
                has_prev=False,
            )

        # Calculate current index
        index_stmt = select(func.count(Screenshot.id)).where(Screenshot.id < screenshot.id)
        if conditions:
            index_stmt = index_stmt.where(and_(*conditions))
        result = await self.db.execute(index_stmt)
        current_index = result.scalar_one() + 1

        # Check for next/prev
        next_stmt = select(func.count(Screenshot.id)).where(Screenshot.id > screenshot.id)
        if conditions:
            next_stmt = next_stmt.where(and_(*conditions))
        result = await self.db.execute(next_stmt)
        has_next = result.scalar_one() > 0

        prev_stmt = select(func.count(Screenshot.id)).where(Screenshot.id < screenshot.id)
        if conditions:
            prev_stmt = prev_stmt.where(and_(*conditions))
        result = await self.db.execute(prev_stmt)
        has_prev = result.scalar_one() > 0

        return NavigationResult(
            screenshot=screenshot,
            current_index=current_index,
            total_in_filter=total_in_filter,
            has_next=has_next,
            has_prev=has_prev,
        )
