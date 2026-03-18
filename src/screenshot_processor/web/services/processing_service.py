"""
Screenshot processing service.

Architecture:
1. process_screenshot_file() - Core sync function, does all the work, no DB
2. update_screenshot_from_result() - Updates model from result dict
3. process_screenshot_async() - Async wrapper for FastAPI (commits to DB)
4. process_screenshot_sync() - Sync wrapper for Celery (commits to DB)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from ...core.interfaces import GridBounds, GridDetectionMethod
from ..config import get_settings

# Lazy sentinel — actual import in process_screenshot_file() to avoid pulling in
# pytesseract/pandas/matplotlib at module load time. Module-level attribute
# needed for unittest.mock.patch() to work.
ScreenshotProcessingService = None

if TYPE_CHECKING:
    from ..database.models import Screenshot

from ..database.models import AnnotationStatus, ProcessingMethod, ProcessingStatus

logger = logging.getLogger(__name__)


# ─── Rust fast-path helpers ──────────────────────────────────────────────────

_DAILY_TOTAL_PHRASES = ("all activity", "daily total", "total activity")


def _is_daily_total_title(title: str | None) -> bool:
    if not title:
        return False
    return any(p in title.lower() for p in _DAILY_TOTAL_PHRASES)


def _hourly_list_to_dict(hourly: list) -> dict:
    """Convert [v0, v1, ...] → {"0": v0, "1": v1, ...} as stored in DB."""
    return {str(i): float(v) for i, v in enumerate(hourly)}


def _try_rust_process_screenshot(
    file_path: str,
    image_type: str,
    grid_coords: dict | None,
    processing_method: str | None,
    existing_title: str | None,
    existing_total: str | None,
) -> dict | None:
    """
    Attempt to process a screenshot using Rust wrappers from rust_accelerator.

    Uses the public wrapper functions (never _rs directly) so thread safety
    and fallback logic are handled in one place.

    Returns the result dict on success, or None to trigger Python fallback.
    """
    from ...core import rust_accelerator

    if not rust_accelerator._check_rust():
        return None

    try:
        if grid_coords:
            # Manual bounds: fast bar-extraction path via process_image_with_grid
            rust_result = rust_accelerator.process_image_with_grid(
                file_path,
                upper_left=(grid_coords["upper_left_x"], grid_coords["upper_left_y"]),
                lower_right=(grid_coords["lower_right_x"], grid_coords["lower_right_y"]),
                image_type=image_type,
            )
            # process_image_with_grid returns hourly_values, total, alignment_score
            # (title/total_text stripped by PyO3 wrapper — use existing values)
            hourly = _hourly_list_to_dict(rust_result["hourly_values"])
            return {
                "success": True,
                "processing_status": "completed",
                "extracted_hourly_data": hourly,
                "extracted_title": existing_title,
                "extracted_total": existing_total,
                "grid_coords": grid_coords,
                "processing_method": "manual",
                "grid_detection_confidence": None,
                "alignment_score": rust_result.get("alignment_score"),
                "title_y_position": None,
                "is_daily_total": False,
                "has_blocking_issues": False,
                "issues": [],
            }
        else:
            # Full pipeline: grid detection + bar extraction + OCR
            method = processing_method or "line_based"
            rust_result = rust_accelerator.process_image(file_path, image_type, method)
            title = rust_result.get("title") or existing_title
            total = rust_result.get("total_text") or existing_total

            if _is_daily_total_title(title):
                return {
                    "success": True,
                    "processing_status": "skipped",
                    "extracted_hourly_data": None,
                    "extracted_title": title,
                    "extracted_total": total,
                    "grid_coords": None,
                    "processing_method": method,
                    "grid_detection_confidence": None,
                    "alignment_score": None,
                    "title_y_position": None,
                    "is_daily_total": True,
                    "has_blocking_issues": False,
                    "issues": [],
                }

            grid_bounds = rust_result.get("grid_bounds")  # dict or absent
            hourly_list = rust_result["hourly_values"]
            has_grid = grid_bounds is not None and any(hourly_list)
            hourly = _hourly_list_to_dict(hourly_list)
            return {
                "success": True,
                "processing_status": "completed" if has_grid else "failed",
                "extracted_hourly_data": hourly if has_grid else None,
                "extracted_title": title,
                "extracted_total": total,
                "grid_coords": grid_bounds,
                "processing_method": rust_result.get("detection_method", method),
                "grid_detection_confidence": None,
                "alignment_score": rust_result.get("alignment_score"),
                "title_y_position": None,
                "is_daily_total": False,
                "has_blocking_issues": not has_grid,
                "issues": [] if has_grid else [
                    {"issue_type": "GridDetection", "severity": "blocking",
                     "description": "Rust pipeline: no grid detected"},
                ],
            }

    except Exception as e:
        logger.debug("Rust fast path failed, falling back to Python: %s", e)
        return None


def process_screenshot_file(
    file_path: str,
    image_type: str,
    grid_coords: dict | None = None,
    processing_method: str | None = None,
    existing_title: str | None = None,
    existing_total: str | None = None,
    use_fallback: bool = True,
    max_shift: int = 0,
) -> dict:
    """
    Process a screenshot file. Core sync function - no database operations.

    This is the single source of truth for screenshot processing logic.

    Args:
        file_path: Path to the image file
        image_type: "screen_time" or "battery"
        grid_coords: Optional manual grid coordinates (skips auto-detection)
        processing_method: Optional specific method ("line_based" or "ocr_anchored")
        existing_title: Existing title to preserve (skip OCR)
        existing_total: Existing total to preserve (skip OCR)
        use_fallback: If True and no specific method requested, fall back from
                      line_based to ocr_anchored on failure
        max_shift: Maximum pixels to shift grid boundaries for optimization (0=disabled)

    Returns:
        dict with processing results
    """
    # ── Rust fast-path (disabled when boundary optimizer is active) ───────────
    if max_shift == 0:
        rust_result = _try_rust_process_screenshot(
            file_path, image_type, grid_coords, processing_method,
            existing_title, existing_total,
        )
        if rust_result is not None:
            # Mirror Python's use_fallback: if line_based found no grid, try ocr_anchored
            if (
                use_fallback
                and not grid_coords
                and rust_result["processing_status"] == "failed"
                and not rust_result.get("grid_coords")
            ):
                rust_fallback = _try_rust_process_screenshot(
                    file_path, image_type, None, "ocr_anchored",
                    existing_title, existing_total,
                )
                if rust_fallback is not None:
                    return rust_fallback
            logger.info(
                "Rust fast path succeeded",
                extra={
                    "file_path": file_path,
                    "processing_time_ms": rust_result.get("processing_time_ms", 0),
                    "used_grid_coords": grid_coords is not None,
                },
            )
            return rust_result
        logger.debug("Rust fast path unavailable, using Python", extra={"file_path": file_path})
    # ── Python path (existing code begins here, unchanged) ───────────────────

    global ScreenshotProcessingService
    if ScreenshotProcessingService is None:
        from ...core.screenshot_processing import ScreenshotProcessingService

    settings = get_settings()
    service = ScreenshotProcessingService(use_fractional=settings.USE_FRACTIONAL_HOURLY_VALUES)

    # Determine detection method and manual bounds
    if grid_coords:
        detection_method = GridDetectionMethod.MANUAL
        manual_bounds = GridBounds(
            upper_left_x=grid_coords["upper_left_x"],
            upper_left_y=grid_coords["upper_left_y"],
            lower_right_x=grid_coords["lower_right_x"],
            lower_right_y=grid_coords["lower_right_y"],
        )
        use_fallback = False  # Manual coords = no fallback needed
    else:
        manual_bounds = None
        if processing_method == "ocr_anchored":
            detection_method = GridDetectionMethod.OCR_ANCHORED
            use_fallback = False  # Specific method requested
        elif processing_method == "line_based":
            detection_method = GridDetectionMethod.LINE_BASED
            use_fallback = False  # Specific method requested
        else:
            detection_method = GridDetectionMethod.LINE_BASED

    # Process
    logger.info(
        "Processing screenshot file",
        extra={
            "file_path": file_path,
            "method": detection_method.value,
            "fallback": use_fallback,
            "max_shift": max_shift,
        },
    )
    result = service.process(
        image_path=file_path,
        image_type=image_type,
        detection_method=detection_method,
        manual_bounds=manual_bounds,
        existing_title=existing_title,
        existing_total=existing_total,
        max_shift=max_shift,
    )

    # Fallback to OCR-anchored only if line-based found no grid coords
    has_grid_coords = result.grid_bounds is not None
    if use_fallback and not has_grid_coords and result.processing_status != "skipped":
        logger.info("Line-based found no grid coords, falling back to OCR-anchored", extra={"file_path": file_path})
        result = service.process(
            image_path=file_path,
            image_type=image_type,
            detection_method=GridDetectionMethod.OCR_ANCHORED,
            existing_title=existing_title,
            existing_total=existing_total,
            max_shift=max_shift,
        )

    return result.to_dict()


def update_screenshot_from_result(screenshot: Screenshot, result: dict) -> None:
    """
    Update a Screenshot model from a processing result dict.

    Does NOT commit - caller is responsible for committing.
    """
    screenshot.processed_at = datetime.now(timezone.utc)
    screenshot.processing_status = ProcessingStatus(result["processing_status"])

    # Truncate title to fit VARCHAR(500) column
    title = result.get("extracted_title")
    screenshot.extracted_title = title[:500] if title else None
    screenshot.extracted_total = result.get("extracted_total")
    screenshot.extracted_hourly_data = result.get("extracted_hourly_data")
    screenshot.processing_issues = result.get("issues")
    screenshot.has_blocking_issues = result.get("has_blocking_issues", False)
    screenshot.alignment_score = result.get("alignment_score")
    screenshot.title_y_position = result.get("title_y_position")

    # Processing method and confidence
    method_str = result.get("processing_method")
    if method_str:
        screenshot.processing_method = ProcessingMethod(method_str)
    screenshot.grid_detection_confidence = result.get("grid_detection_confidence")

    # Grid coordinates
    if result.get("grid_coords"):
        coords = result["grid_coords"]
        screenshot.grid_upper_left_x = coords.get("upper_left_x")
        screenshot.grid_upper_left_y = coords.get("upper_left_y")
        screenshot.grid_lower_right_x = coords.get("lower_right_x")
        screenshot.grid_lower_right_y = coords.get("lower_right_y")

    # Daily total = skip annotation
    if result["processing_status"] == "skipped":
        screenshot.annotation_status = AnnotationStatus.SKIPPED


# =============================================================================
# Async wrapper for FastAPI
# =============================================================================


async def process_screenshot_async(
    db: AsyncSession,
    screenshot: Screenshot,
    grid_coords: dict | None = None,
    processing_method: str | None = None,
    current_user_id: int | None = None,
    max_shift: int = 0,
) -> dict:
    """
    Process a screenshot and save to database. Async version for FastAPI.

    Args:
        db: Async database session
        screenshot: Screenshot model to process
        grid_coords: Optional manual grid coordinates
        processing_method: Optional specific method
        current_user_id: If provided, block reprocessing if user verified this screenshot
        max_shift: Maximum pixels to shift grid for optimization (0=disabled)
    """
    # Block if current user already verified
    if current_user_id and screenshot.verified_by_user_ids:
        if current_user_id in screenshot.verified_by_user_ids:
            logger.info(
                "Screenshot verified by user, skipping reprocess",
                extra={"screenshot_id": screenshot.id, "user_id": current_user_id},
            )
            return {
                "success": False,
                "skipped": True,
                "skip_reason": "verified_by_user",
                "message": "This screenshot has been verified by you and cannot be reprocessed.",
                "processing_status": screenshot.processing_status.value
                if screenshot.processing_status
                else "completed",
            }

    # Process file
    result = process_screenshot_file(
        file_path=screenshot.file_path,
        image_type=screenshot.image_type,
        grid_coords=grid_coords,
        processing_method=processing_method,
        existing_title=screenshot.extracted_title,
        existing_total=screenshot.extracted_total,
        max_shift=max_shift,
    )

    # Update model and commit
    update_screenshot_from_result(screenshot, result)
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(screenshot, "extracted_hourly_data")
    flag_modified(screenshot, "processing_issues")
    await db.commit()
    await db.refresh(screenshot)

    return result


# =============================================================================
# Sync wrapper for Celery
# =============================================================================


def process_screenshot_sync(
    db: Session,
    screenshot: Screenshot,
    grid_coords: dict | None = None,
    processing_method: str | None = None,
    max_shift: int = 0,
) -> dict:
    """
    Process a screenshot and save to database. Sync version for Celery.

    Args:
        db: Sync database session
        screenshot: Screenshot model to process
        grid_coords: Optional manual grid coordinates
        processing_method: Optional specific method
        max_shift: Maximum pixels to shift grid for optimization (0=disabled)
    """
    result = process_screenshot_file(
        file_path=screenshot.file_path,
        image_type=screenshot.image_type,
        grid_coords=grid_coords,
        processing_method=processing_method,
        existing_title=screenshot.extracted_title,
        existing_total=screenshot.extracted_total,
        max_shift=max_shift,
    )

    update_screenshot_from_result(screenshot, result)
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(screenshot, "extracted_hourly_data")
    flag_modified(screenshot, "processing_issues")
    db.commit()
    db.refresh(screenshot)

    return result


# =============================================================================
# Named wrapper for reprocessing operations
# =============================================================================


async def reprocess_screenshot(
    db: AsyncSession,
    screenshot: Screenshot,
    grid_coords: dict | None = None,
    output_dir=None,  # Unused, kept for API compatibility
    processing_method: str | None = None,
    current_user_id: int | None = None,
    max_shift: int = 0,
) -> dict:
    """Reprocess an existing screenshot with optional new parameters."""
    return await process_screenshot_async(db, screenshot, grid_coords, processing_method, current_user_id, max_shift)
