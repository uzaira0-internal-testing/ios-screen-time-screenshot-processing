from typing import Annotated, NoReturn

import asyncio
import base64
import hashlib
import logging
import re
import uuid
from pathlib import Path

import aiofiles
import cv2
from fastapi import APIRouter, Body, Header, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from fastapi_pagination import PaginatedResponse
from pydantic import BaseModel
from sqlalchemy import String, cast, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from screenshot_processor.core.image_utils import convert_dark_mode
from screenshot_processor.core.ocr import find_screenshot_total_usage
from screenshot_processor.web.api.dependencies import CurrentUser, DatabaseSession
from screenshot_processor.web.config import get_settings
from screenshot_processor.web.rate_limiting import limiter
from screenshot_processor.web.database import (
    Annotation,
    AnnotationStatus,
    BatchItemResult,
    BatchUploadRequest,
    BatchUploadResponse,
    ConsensusResult,
    Group,
    GroupRead,
    NextScreenshotResponse,
    ProcessingResultResponse,
    ProcessingStatus,
    ReprocessRequest,
    Screenshot,
    ScreenshotDetail,
    ScreenshotRead,
    ScreenshotUpdate,
    ScreenshotUploadRequest,
    ScreenshotUploadResponse,
    StatsResponse,
    UploadErrorCode,
    UserQueueState,
)
from screenshot_processor.web.services import QueueService, reprocess_screenshot
from screenshot_processor.web.repositories import ScreenshotRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/screenshots", tags=["Screenshots"])


# ============================================================================
# Helper functions
# ============================================================================


async def get_screenshot_or_404(db: AsyncSession, screenshot_id: int) -> Screenshot:
    """Get screenshot by ID or raise 404."""
    repo = ScreenshotRepository(db)
    screenshot = await repo.get_by_id(screenshot_id)
    if not screenshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")
    return screenshot


async def get_screenshot_for_update(db: AsyncSession, screenshot_id: int) -> Screenshot:
    """Get screenshot with row lock for safe concurrent updates."""
    repo = ScreenshotRepository(db)
    screenshot = await repo.get_by_id_for_update(screenshot_id)
    if not screenshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screenshot not found")
    return screenshot


async def ensure_ocr_total(screenshot: Screenshot, db: AsyncSession) -> None:
    """
    Extract and save OCR total if screenshot is missing it.
    Only applies to screen_time type screenshots.
    """
    # IMPORTANT: Never modify verified screenshots - they are frozen
    if screenshot.verified_by_user_ids and len(screenshot.verified_by_user_ids) > 0:
        return

    # Skip if not screen_time or already has a total
    if screenshot.image_type != "screen_time":
        return
    if screenshot.extracted_total and screenshot.extracted_total.strip():
        return

    try:
        file_path = screenshot.file_path
        if not Path(file_path).exists():
            logger.warning(f"Screenshot {screenshot.id}: File not found at {file_path}")
            return

        # Read and process the image
        img = cv2.imread(file_path)
        if img is None:
            logger.warning(f"Screenshot {screenshot.id}: Could not read image at {file_path}")
            return

        # Convert dark mode if needed
        img = convert_dark_mode(img)

        # Extract the total using OCR
        total, _ = find_screenshot_total_usage(img)

        if total and total.strip():
            screenshot.extracted_total = total.strip()
            await db.commit()
            logger.info(f"Screenshot {screenshot.id}: Auto-extracted OCR total = '{total.strip()}'")

    except Exception as e:
        logger.error(f"Screenshot {screenshot.id}: Error auto-extracting OCR total - {e}")


async def enrich_screenshot_with_usernames(screenshot: Screenshot, db: AsyncSession) -> ScreenshotRead:
    """Convert a Screenshot model to ScreenshotRead and populate verified_by_usernames."""
    repo = ScreenshotRepository(db)
    return await repo.enrich_with_usernames(screenshot)


async def enrich_screenshots_with_usernames(screenshots: list[Screenshot], db: AsyncSession) -> list[ScreenshotRead]:
    """Convert a list of Screenshot models to ScreenshotRead with verified_by_usernames populated."""
    repo = ScreenshotRepository(db)
    return await repo.enrich_many_with_usernames(screenshots)


# ============================================================================
# Groups Endpoints (must be before /{screenshot_id} routes to avoid conflicts)
# ============================================================================


@router.get("/groups", response_model=list[GroupRead], tags=["Groups"])
async def list_groups(db: DatabaseSession):
    """List all groups with screenshot counts by processing_status."""
    repo = ScreenshotRepository(db)
    return await repo.list_groups()


@router.get("/groups/{group_id}", response_model=GroupRead, tags=["Groups"])
async def get_group(group_id: str, db: DatabaseSession):
    """Get a single group by ID with screenshot counts."""
    repo = ScreenshotRepository(db)
    group = await repo.get_group(group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


@router.get("/next", response_model=NextScreenshotResponse)
async def get_next_screenshot(
    current_user: CurrentUser,
    db: DatabaseSession,
    group: str | None = Query(None, description="Filter by group ID"),
    processing_status: str | None = Query(
        None, description="Filter by processing status (pending, completed, failed, skipped)"
    ),
    browse: bool = Query(False, description="Enable browse mode to view all matching screenshots"),
):
    queue_service = QueueService()
    # Enable browse mode when explicitly filtering by processing_status
    # This allows viewing all screenshots with that status, including verified ones
    browse_mode = browse or processing_status is not None
    screenshot = await queue_service.get_next_screenshot(
        db, current_user.id, group_id=group, processing_status=processing_status, browse_mode=browse_mode
    )

    stats = await queue_service.get_queue_stats(db, current_user.id)

    if not screenshot:
        return NextScreenshotResponse(
            screenshot=None,
            queue_position=0,
            total_remaining=stats["total_remaining"],
            message="No screenshots available in your queue",
        )

    # Auto-extract OCR total if missing
    await ensure_ocr_total(screenshot, db)

    return NextScreenshotResponse(
        screenshot=await enrich_screenshot_with_usernames(screenshot, db),
        queue_position=1,
        total_remaining=stats["total_remaining"],
        message=None,
    )


@router.get("/disputed", response_model=list[ScreenshotRead])
async def get_disputed_screenshots(current_user: CurrentUser, db: DatabaseSession):
    queue_service = QueueService()
    screenshots = await queue_service.get_disputed_screenshots(db, current_user.id)

    return await enrich_screenshots_with_usernames(screenshots, db)


@router.get("/stats", response_model=StatsResponse)
async def get_screenshot_stats(db: DatabaseSession, current_user: CurrentUser):
    """Get screenshot statistics using consolidated queries."""
    repo = ScreenshotRepository(db)
    stats = await repo.get_stats()

    avg_annotations = stats.total_annotations / stats.total if stats.total > 0 else 0.0

    return StatsResponse(
        total_screenshots=stats.total,
        pending_screenshots=stats.pending_annotation,
        completed_screenshots=stats.completed_annotation,
        total_annotations=stats.total_annotations,
        screenshots_with_consensus=stats.with_consensus,
        screenshots_with_disagreements=stats.with_disagreements,
        average_annotations_per_screenshot=avg_annotations,
        users_active=stats.users_active,
        auto_processed=stats.auto_processed,
        pending=stats.pending_processing,
        failed=stats.failed,
        skipped=stats.skipped,
    )


@router.get("/list", response_model=PaginatedResponse[ScreenshotRead])
async def list_screenshots_paginated(
    db: DatabaseSession,
    current_user: CurrentUser,
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(50, ge=1, le=5000, description="Items per page"),
    group_id: str | None = Query(None, description="Filter by group ID"),
    processing_status: str | None = Query(None, description="Filter by processing status"),
    verified_by_me: bool | None = Query(None, description="Filter by current user's verification (True=verified by me, False=not verified by me)"),
    verified_by_others: bool | None = Query(None, description="Filter for screenshots verified by others but not current user (True only)"),
    search: str | None = Query(None, description="Search by ID or participant ID"),
    sort_by: str = Query("id", description="Sort field: id, uploaded_at, processing_status"),
    sort_order: str = Query("asc", description="Sort order: asc, desc"),
):
    """List screenshots with comprehensive filtering and pagination."""
    repo = ScreenshotRepository(db)
    result = await repo.list_with_filters(
        page=page,
        page_size=page_size,
        group_id=group_id,
        processing_status=processing_status,
        verified_by_me=verified_by_me,
        verified_by_others=verified_by_others,
        current_user_id=current_user.id,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    return PaginatedResponse(
        items=await repo.enrich_many_with_usernames(result.items),
        total=result.total,
        page=page,
        page_size=page_size,
    )


@router.get("/{screenshot_id}", response_model=ScreenshotDetail)
async def get_screenshot(screenshot_id: int, db: DatabaseSession, current_user: CurrentUser):
    repo = ScreenshotRepository(db)
    screenshot = await get_screenshot_or_404(db, screenshot_id)

    annotations_count = await repo.get_annotation_count(screenshot_id)
    needs_annotations = max(0, screenshot.target_annotations - annotations_count)

    # Check for potential semantic duplicates
    duplicate_id = await repo.find_potential_duplicate(screenshot)

    screenshot_data = await repo.enrich_with_usernames(screenshot)
    screenshot_data.potential_duplicate_of = duplicate_id

    return ScreenshotDetail(
        **screenshot_data.model_dump(),
        annotations_count=annotations_count,
        needs_annotations=needs_annotations,
    )


@router.patch("/{screenshot_id}", response_model=ScreenshotRead)
async def update_screenshot(
    screenshot_id: int,
    update_data: ScreenshotUpdate,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    """
    Update a screenshot's metadata (e.g., extracted_title).
    """
    screenshot = await get_screenshot_or_404(db, screenshot_id)

    try:
        # Update only provided fields
        update_dict = update_data.model_dump(exclude_unset=True)
        for field, value in update_dict.items():
            setattr(screenshot, field, value)

        await db.commit()
        await db.refresh(screenshot)

        logger.info(f"Screenshot {screenshot_id} updated by {current_user.username}")
        return await enrich_screenshot_with_usernames(screenshot, db)

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to update screenshot {screenshot_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update screenshot",
        )


# Old /upload endpoint removed - use the main /upload endpoint below which accepts base64 images


@router.get("/", response_model=list[ScreenshotRead])
async def list_screenshots(
    db: DatabaseSession,
    current_user: CurrentUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status: str | None = Query(None),
):
    stmt = select(Screenshot)

    if status:
        stmt = stmt.where(Screenshot.annotation_status == status)

    stmt = stmt.offset(skip).limit(limit).order_by(Screenshot.uploaded_at.desc())

    result = await db.execute(stmt)
    screenshots = result.scalars().all()

    return [ScreenshotRead.model_validate(s) for s in screenshots]


@router.post("/{screenshot_id}/skip", status_code=status.HTTP_204_NO_CONTENT)
async def skip_screenshot(screenshot_id: int, db: DatabaseSession, current_user: CurrentUser):
    """
    Skip a screenshot globally by setting processing_status to 'skipped'.
    This moves it to the skipped category visible on the homepage.
    """
    screenshot = await get_screenshot_or_404(db, screenshot_id)

    old_status = screenshot.processing_status
    logger.info(f"Screenshot {screenshot_id}: skip requested by {current_user.username}, current status={old_status}")

    # Update the global processing status to skipped
    screenshot.processing_status = ProcessingStatus.SKIPPED
    await db.commit()
    await db.refresh(screenshot)

    logger.info(f"Screenshot {screenshot_id}: skipped by {current_user.username}, old={old_status} -> new={screenshot.processing_status}")


class UnskipResponse(BaseModel):
    """Response for unskip operation."""

    success: bool
    message: str


@router.post("/{screenshot_id}/unskip", response_model=UnskipResponse)
async def unskip_screenshot(screenshot_id: int, db: DatabaseSession, current_user: CurrentUser):
    """
    Unskip a screenshot by restoring processing_status to 'completed'.
    """
    screenshot = await get_screenshot_or_404(db, screenshot_id)

    old_status = screenshot.processing_status
    logger.info(f"Screenshot {screenshot_id}: unskip requested by {current_user.username}, current status={old_status}")

    if screenshot.processing_status != ProcessingStatus.SKIPPED:
        logger.warning(f"Screenshot {screenshot_id}: cannot unskip, status is {old_status} not SKIPPED")
        return UnskipResponse(success=False, message="Screenshot is not in skipped status")

    # Restore to completed status
    screenshot.processing_status = ProcessingStatus.COMPLETED
    await db.commit()
    await db.refresh(screenshot)
    logger.info(f"Screenshot {screenshot_id}: unskipped by {current_user.username}, old={old_status} -> new={screenshot.processing_status}")

    return UnskipResponse(success=True, message="Screenshot has been restored to completed status")


class VerifyRequest(BaseModel):
    """Optional grid coordinates to save when verifying."""

    grid_upper_left_x: int | None = None
    grid_upper_left_y: int | None = None
    grid_lower_right_x: int | None = None
    grid_lower_right_y: int | None = None


@router.post("/{screenshot_id}/verify", response_model=ScreenshotRead)
async def verify_screenshot(
    screenshot_id: int,
    db: DatabaseSession,
    current_user: CurrentUser,
    request: VerifyRequest | None = None,
):
    """
    Mark a screenshot as verified by the current user.
    This adds the user's ID to the verified_by_user_ids list without removing the screenshot from the queue.
    Optionally saves the current grid coordinates to freeze them at verification time.
    """
    from sqlalchemy.orm.attributes import flag_modified

    logger.info(f"Screenshot {screenshot_id}: verify requested by user_id={current_user.id} ({current_user.username})")

    # Use row lock to prevent race condition when multiple users verify simultaneously
    screenshot = await get_screenshot_for_update(db, screenshot_id)

    try:
        # Initialize list if null - make a copy to avoid mutation issues
        old_verified_ids = list(screenshot.verified_by_user_ids or [])
        logger.info(f"Screenshot {screenshot_id}: current verified_by_user_ids = {old_verified_ids}")

        # Add user if not already verified
        if current_user.id not in old_verified_ids:
            new_verified_ids = old_verified_ids + [current_user.id]
            # Assign a new list to ensure SQLAlchemy detects the change
            screenshot.verified_by_user_ids = new_verified_ids
            flag_modified(screenshot, "verified_by_user_ids")

        # Save grid coordinates if provided (freeze grid at verification time)
        if request:
            if request.grid_upper_left_x is not None:
                screenshot.grid_upper_left_x = request.grid_upper_left_x
            if request.grid_upper_left_y is not None:
                screenshot.grid_upper_left_y = request.grid_upper_left_y
            if request.grid_lower_right_x is not None:
                screenshot.grid_lower_right_x = request.grid_lower_right_x
            if request.grid_lower_right_y is not None:
                screenshot.grid_lower_right_y = request.grid_lower_right_y

        await db.commit()
        await db.refresh(screenshot)
        logger.info(f"Screenshot {screenshot_id}: verified by {current_user.username}, old={old_verified_ids} -> new={screenshot.verified_by_user_ids}")

        return await enrich_screenshot_with_usernames(screenshot, db)

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to verify screenshot {screenshot_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify screenshot",
        )


@router.delete("/{screenshot_id}/verify", response_model=ScreenshotRead)
async def unverify_screenshot(screenshot_id: int, db: DatabaseSession, current_user: CurrentUser):
    """
    Remove verification mark from a screenshot for the current user.
    """
    from sqlalchemy.orm.attributes import flag_modified

    logger.info(f"Screenshot {screenshot_id}: unverify requested by user_id={current_user.id} ({current_user.username})")

    # Use row lock to prevent race condition when multiple users unverify simultaneously
    screenshot = await get_screenshot_for_update(db, screenshot_id)

    try:
        # Remove user from verified list
        old_verified_ids = list(screenshot.verified_by_user_ids or [])
        logger.info(f"Screenshot {screenshot_id}: current verified_by_user_ids = {old_verified_ids}")

        if current_user.id in old_verified_ids:
            new_verified_ids = [uid for uid in old_verified_ids if uid != current_user.id]
            screenshot.verified_by_user_ids = new_verified_ids if new_verified_ids else None
            flag_modified(screenshot, "verified_by_user_ids")  # Tell SQLAlchemy the field changed
            await db.commit()
            await db.refresh(screenshot)
            logger.info(f"Screenshot {screenshot_id}: unverified by {current_user.username}, old={old_verified_ids} -> new={screenshot.verified_by_user_ids}")
        else:
            logger.warning(f"Screenshot {screenshot_id}: user_id={current_user.id} not in verified list {old_verified_ids}")

        return await enrich_screenshot_with_usernames(screenshot, db)

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to unverify screenshot {screenshot_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to unverify screenshot",
        )


class NavigationResponse(BaseModel):
    """Response for navigation endpoints."""

    screenshot: ScreenshotRead | None
    current_index: int
    total_in_filter: int
    has_next: bool
    has_prev: bool


@router.get("/{screenshot_id}/navigate", response_model=NavigationResponse)
async def get_screenshot_navigation(
    screenshot_id: int,
    db: DatabaseSession,
    current_user: CurrentUser,
    group_id: str | None = Query(None, description="Filter by group ID"),
    processing_status: str | None = Query(None, description="Filter by processing status"),
    verified_by_me: bool | None = Query(None, description="Filter by current user's verification (True=verified by me, False=not verified by me)"),
    verified_by_others: bool | None = Query(None, description="Filter for screenshots verified by others but not current user (True only)"),
    direction: str = Query("current", description="Direction: current, next, prev"),
):
    """
    Get a screenshot with navigation context within filtered results.
    Returns the current, next, or previous screenshot based on direction.
    """
    from sqlalchemy import and_, literal, or_

    # Build base conditions for the filtered set
    conditions = []
    if group_id:
        conditions.append(Screenshot.group_id == group_id)
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
    if verified_by_me is not None:
        if verified_by_me is True:
            # Verified BY ME: my user ID is in the verified_by_user_ids array
            conditions.append(user_in_verified_list(current_user.id))
        else:
            # NOT verified by me: my user ID is NOT in the array (or array is null/empty)
            conditions.append(
                or_(
                    ~has_verifications(),
                    ~user_in_verified_list(current_user.id),
                )
            )

    # Verified by others filter (verified by someone, but not by current user)
    if verified_by_others is True:
        # Has verifications AND current user is NOT in the list
        conditions.append(has_verifications())
        conditions.append(~user_in_verified_list(current_user.id))

    # Get total count in filter
    count_stmt = select(func.count(Screenshot.id))
    if conditions:
        count_stmt = count_stmt.where(and_(*conditions))
    result = await db.execute(count_stmt)
    total_in_filter = result.scalar_one()

    # Get the target screenshot based on direction
    if direction == "next":
        # Get next screenshot after current ID
        stmt = select(Screenshot).where(Screenshot.id > screenshot_id)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(Screenshot.id.asc()).limit(1)
    elif direction == "prev":
        # Get previous screenshot before current ID
        stmt = select(Screenshot).where(Screenshot.id < screenshot_id)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(Screenshot.id.desc()).limit(1)
    else:
        # Get current screenshot
        stmt = select(Screenshot).where(Screenshot.id == screenshot_id)
        if conditions:
            stmt = stmt.where(and_(*conditions))

    result = await db.execute(stmt)
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        # If no screenshot found in direction, return null with context
        return NavigationResponse(
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
    result = await db.execute(index_stmt)
    current_index = result.scalar_one() + 1  # 1-indexed

    # Check if there's a next screenshot
    next_stmt = select(func.count(Screenshot.id)).where(Screenshot.id > screenshot.id)
    if conditions:
        next_stmt = next_stmt.where(and_(*conditions))
    result = await db.execute(next_stmt)
    has_next = result.scalar_one() > 0

    # Check if there's a previous screenshot
    prev_stmt = select(func.count(Screenshot.id)).where(Screenshot.id < screenshot.id)
    if conditions:
        prev_stmt = prev_stmt.where(and_(*conditions))
    result = await db.execute(prev_stmt)
    has_prev = result.scalar_one() > 0

    # Auto-extract OCR total if missing
    await ensure_ocr_total(screenshot, db)

    return NavigationResponse(
        screenshot=await enrich_screenshot_with_usernames(screenshot, db),
        current_index=current_index,
        total_in_filter=total_in_filter,
        has_next=has_next,
        has_prev=has_prev,
    )


@router.get("/{screenshot_id}/image")
async def get_screenshot_image(screenshot_id: int, db: DatabaseSession):
    screenshot = await get_screenshot_or_404(db, screenshot_id)

    # Path traversal protection: ensure file is within UPLOAD_DIR
    settings = get_settings()
    upload_dir = Path(settings.UPLOAD_DIR).resolve()
    file_path = Path(screenshot.file_path).resolve()

    # Ensure file is within upload directory
    try:
        file_path.relative_to(upload_dir)
    except ValueError:
        # file_path is not relative to upload_dir - path traversal attempt
        logger.warning(f"Path traversal attempt detected: {screenshot.file_path} is outside {upload_dir}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found")

    media_type = "image/png"
    if file_path.suffix.lower() in [".jpg", ".jpeg"]:
        media_type = "image/jpeg"
    elif file_path.suffix.lower() == ".gif":
        media_type = "image/gif"

    return FileResponse(file_path, media_type=media_type)


class RecalculateOcrResponse(BaseModel):
    """Response for OCR recalculation."""

    success: bool
    extracted_total: str | None = None
    message: str


@router.post("/{screenshot_id}/recalculate-ocr", response_model=RecalculateOcrResponse)
async def recalculate_ocr_total(screenshot_id: int, db: DatabaseSession, current_user: CurrentUser):
    """
    Recalculate the OCR total for a specific screenshot.
    Re-runs OCR extraction on the original image to get the total usage time.
    """
    screenshot = await get_screenshot_or_404(db, screenshot_id)

    if screenshot.image_type != "screen_time":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OCR recalculation only applies to screen_time screenshots",
        )

    try:
        file_path = screenshot.file_path
        if not Path(file_path).exists():
            return RecalculateOcrResponse(
                success=False,
                extracted_total=None,
                message=f"Image file not found at {file_path}",
            )

        # Read and process the image
        img = cv2.imread(file_path)
        if img is None:
            return RecalculateOcrResponse(
                success=False,
                extracted_total=None,
                message="Could not read image file",
            )

        # Convert dark mode if needed
        img = convert_dark_mode(img)

        # Extract the total using OCR
        total, _ = find_screenshot_total_usage(img)

        if total and total.strip():
            screenshot.extracted_total = total.strip()
            await db.commit()
            await db.refresh(screenshot)
            logger.info(f"Screenshot {screenshot_id}: Recalculated OCR total = '{total.strip()}'")
            return RecalculateOcrResponse(
                success=True,
                extracted_total=total.strip(),
                message="OCR total recalculated successfully",
            )
        else:
            return RecalculateOcrResponse(
                success=False,
                extracted_total=None,
                message="No total found in image",
            )

    except Exception as e:
        await db.rollback()
        logger.error(f"Screenshot {screenshot_id}: Error recalculating OCR total - {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to recalculate OCR total: {str(e)}",
        )


@router.get("/{screenshot_id}/processing-result", response_model=ProcessingResultResponse)
async def get_processing_result(screenshot_id: int, db: DatabaseSession, current_user: CurrentUser):
    screenshot = await get_screenshot_or_404(db, screenshot_id)

    return ProcessingResultResponse(
        success=screenshot.processing_status not in [ProcessingStatus.PENDING, ProcessingStatus.FAILED],
        processing_status=screenshot.processing_status.value,
        extracted_title=screenshot.extracted_title,
        extracted_total=screenshot.extracted_total,
        extracted_hourly_data=screenshot.extracted_hourly_data,
        issues=screenshot.processing_issues or [],
        has_blocking_issues=screenshot.has_blocking_issues,
        is_daily_total=screenshot.processing_status == ProcessingStatus.SKIPPED,
    )


@router.post("/{screenshot_id}/reprocess", response_model=ProcessingResultResponse)
async def reprocess_screenshot_endpoint(
    screenshot_id: int,
    reprocess_request: ReprocessRequest,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    """
    Reprocess a screenshot with optional grid coordinates and processing method.

    Processing methods:
    - If grid coordinates are provided, uses "manual" method
    - If processing_method="line_based", uses visual line detection (no OCR for grid)
    - Otherwise, uses "ocr_anchored" method (finds "12 AM" and "60" text anchors)
    """
    screenshot = await get_screenshot_or_404(db, screenshot_id)

    grid_coords = None
    if reprocess_request.grid_upper_left_x is not None and reprocess_request.grid_lower_right_x is not None:
        grid_coords = {
            "upper_left_x": reprocess_request.grid_upper_left_x,
            "upper_left_y": reprocess_request.grid_upper_left_y,
            "lower_right_x": reprocess_request.grid_lower_right_x,
            "lower_right_y": reprocess_request.grid_lower_right_y,
        }

    processing_result = await reprocess_screenshot(
        db,
        screenshot,
        grid_coords=grid_coords,
        processing_method=reprocess_request.processing_method,
        current_user_id=current_user.id,
        max_shift=reprocess_request.max_shift,
    )

    # Handle case where processing_result is None (shouldn't happen, but be defensive)
    if processing_result is None:
        processing_result = {
            "success": False,
            "processing_status": "failed",
            "issues": [
                {
                    "issue_type": "processing_error",
                    "severity": "blocking",
                    "description": "Processing returned no result",
                }
            ],
            "has_blocking_issues": True,
        }

    # Extract grid coordinates from result (populated by line-based/ocr detection)
    # or from the screenshot model (after commit in reprocess_screenshot)
    result_grid_coords = processing_result.get("grid_coords") or {}

    return ProcessingResultResponse(
        success=processing_result.get("success", False),
        processing_status=processing_result.get("processing_status", ProcessingStatus.FAILED.value),
        extracted_title=processing_result.get("extracted_title"),
        extracted_total=processing_result.get("extracted_total"),
        extracted_hourly_data=processing_result.get("extracted_hourly_data"),
        issues=processing_result.get("issues", []),
        has_blocking_issues=processing_result.get("has_blocking_issues", False),
        is_daily_total=processing_result.get("is_daily_total", False),
        alignment_score=processing_result.get("alignment_score"),
        processing_method=processing_result.get("processing_method"),
        grid_detection_confidence=processing_result.get("grid_detection_confidence"),
        # Grid coordinates for frontend overlay
        grid_upper_left_x=result_grid_coords.get("upper_left_x") or screenshot.grid_upper_left_x,
        grid_upper_left_y=result_grid_coords.get("upper_left_y") or screenshot.grid_upper_left_y,
        grid_lower_right_x=result_grid_coords.get("lower_right_x") or screenshot.grid_lower_right_x,
        grid_lower_right_y=result_grid_coords.get("lower_right_y") or screenshot.grid_lower_right_y,
    )


# ============================================================================
# API Upload Endpoint (for external sources like Dagster pipelines)
# ============================================================================


def sanitize_filename(name: str) -> str:
    """Remove path components and dangerous characters from filename."""
    # Extract just the filename, removing any path components
    name = Path(name).name
    # Replace any non-alphanumeric characters (except dash, underscore, and dot) with underscore
    sanitized = re.sub(r"[^\w\-.]", "_", name)
    # Limit length to prevent filesystem issues
    return sanitized[:100]


def _detect_device_type(width: int, height: int) -> str:
    """Detect device type from image dimensions."""
    aspect_ratio = height / width if width > 0 else 0

    if aspect_ratio > 2.0:
        return "iphone_modern"  # iPhone X and later (19.5:9)
    elif aspect_ratio > 1.7:
        return "iphone_legacy"  # iPhone 8 and earlier (16:9)
    elif aspect_ratio < 1.5:
        return "ipad"
    else:
        return "unknown"


def _get_image_dimensions(image_data: bytes) -> tuple[int, int]:
    """Get image dimensions from binary data."""
    # PNG signature check
    if image_data[:8] == b"\x89PNG\r\n\x1a\n":
        # PNG: width and height are at bytes 16-24
        width = int.from_bytes(image_data[16:20], "big")
        height = int.from_bytes(image_data[20:24], "big")
        return width, height

    # JPEG signature check
    if image_data[:2] == b"\xff\xd8":
        # JPEG: need to parse markers to find SOF
        i = 2
        while i < len(image_data) - 9:
            if image_data[i] != 0xFF:
                i += 1
                continue
            marker = image_data[i + 1]
            # SOF markers (0xC0-0xCF except 0xC4, 0xC8, 0xCC)
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height = int.from_bytes(image_data[i + 5 : i + 7], "big")
                width = int.from_bytes(image_data[i + 7 : i + 9], "big")
                return width, height
            # Skip to next marker
            length = int.from_bytes(image_data[i + 2 : i + 4], "big")
            i += 2 + length

    return 0, 0


def _raise_upload_error(
    error_code: "UploadErrorCode",
    detail: str,
    screenshot_index: int | None = None,
) -> NoReturn:
    """Raise an HTTPException with structured upload error response."""
    from screenshot_processor.web.database import UploadErrorCode, UploadErrorResponse

    error_response = UploadErrorResponse(
        error_code=error_code,
        detail=detail,
        screenshot_index=screenshot_index,
    )

    status_map = {
        UploadErrorCode.INVALID_API_KEY: status.HTTP_401_UNAUTHORIZED,
        UploadErrorCode.INVALID_BASE64: status.HTTP_400_BAD_REQUEST,
        UploadErrorCode.UNSUPPORTED_FORMAT: status.HTTP_400_BAD_REQUEST,
        UploadErrorCode.IMAGE_TOO_LARGE: status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        UploadErrorCode.CHECKSUM_MISMATCH: status.HTTP_400_BAD_REQUEST,
        UploadErrorCode.INVALID_CALLBACK_URL: status.HTTP_400_BAD_REQUEST,
        UploadErrorCode.BATCH_TOO_LARGE: status.HTTP_400_BAD_REQUEST,
        UploadErrorCode.RATE_LIMITED: status.HTTP_429_TOO_MANY_REQUESTS,
        UploadErrorCode.STORAGE_ERROR: status.HTTP_500_INTERNAL_SERVER_ERROR,
        UploadErrorCode.DATABASE_ERROR: status.HTTP_500_INTERNAL_SERVER_ERROR,
    }

    raise HTTPException(
        status_code=status_map.get(error_code, status.HTTP_500_INTERNAL_SERVER_ERROR),
        detail=error_response.model_dump(),
    )


def _decode_and_validate_image(
    screenshot_b64: str,
    expected_sha256: str | None = None,
) -> tuple[bytes, str, tuple[int, int]]:
    """Decode base64 image and validate format/checksum.

    Returns:
        Tuple of (image_data, extension, (width, height))

    Raises:
        HTTPException with structured error on failure
    """
    from screenshot_processor.web.database import UploadErrorCode

    # Decode base64
    try:
        if screenshot_b64.startswith("data:"):
            _, encoded = screenshot_b64.split(",", 1)
        else:
            encoded = screenshot_b64
        image_data = base64.b64decode(encoded)
    except Exception as e:
        _raise_upload_error(UploadErrorCode.INVALID_BASE64, f"Invalid base64 image data: {e}")

    # Verify SHA256 checksum if provided
    if expected_sha256:
        actual_sha256 = hashlib.sha256(image_data).hexdigest()
        if actual_sha256.lower() != expected_sha256.lower():
            _raise_upload_error(
                UploadErrorCode.CHECKSUM_MISMATCH,
                f"SHA256 mismatch: expected {expected_sha256}, got {actual_sha256}",
            )

    # Detect image format
    if image_data[:8] == b"\x89PNG\r\n\x1a\n":
        extension = ".png"
    elif image_data[:2] == b"\xff\xd8":
        extension = ".jpg"
    else:
        _raise_upload_error(
            UploadErrorCode.UNSUPPORTED_FORMAT,
            "Unsupported image format. Only PNG and JPEG are supported.",
        )

    # Get dimensions
    width, height = _get_image_dimensions(image_data)

    return image_data, extension, (width, height)


def _validate_callback_url(callback_url: str | None) -> None:
    """Validate callback URL format if provided."""
    from screenshot_processor.web.database import UploadErrorCode

    if callback_url:
        from urllib.parse import urlparse

        try:
            parsed = urlparse(callback_url)
            if parsed.scheme not in ("http", "https"):
                _raise_upload_error(
                    UploadErrorCode.INVALID_CALLBACK_URL,
                    "Callback URL must use http or https scheme",
                )
            if not parsed.netloc:
                _raise_upload_error(
                    UploadErrorCode.INVALID_CALLBACK_URL,
                    "Callback URL must have a valid host",
                )
        except Exception as e:
            _raise_upload_error(
                UploadErrorCode.INVALID_CALLBACK_URL,
                f"Invalid callback URL: {e}",
            )


async def _process_single_upload(
    db: AsyncSession,
    image_data: bytes,
    extension: str,
    dimensions: tuple[int, int],
    participant_id: str,
    group_id: str,
    image_type: str,
    device_type: str | None,
    filename: str | None,
    source_id: str | None,
    original_filepath: str | None,
    screenshot_date,
    callback_url: str | None,
    idempotency_key: str | None,
    group_created: bool,
) -> ScreenshotUploadResponse:
    """Process a single screenshot upload and return response with full metadata."""
    import time
    from screenshot_processor.web.database import UploadErrorCode

    timings = {}
    t0 = time.perf_counter()

    width, height = dimensions

    # Auto-detect device type if not provided
    detected_device_type = device_type
    if not detected_device_type and width > 0 and height > 0:
        detected_device_type = _detect_device_type(width, height)

    # Generate unique filename - use faster hash for deduplication
    # xxhash would be faster, but hashlib.blake2b is ~2x faster than MD5 and built-in
    t1 = time.perf_counter()
    file_hash = hashlib.blake2b(image_data, digest_size=6).hexdigest()
    timings["hash"] = (time.perf_counter() - t1) * 1000

    if filename:
        safe_filename = sanitize_filename(filename)
        base_name = Path(safe_filename).stem
        final_filename = f"{group_id}/{participant_id}/{base_name}_{file_hash}{extension}"
    else:
        unique_id = str(uuid.uuid4())[:8]
        final_filename = f"{group_id}/{participant_id}/{unique_id}_{file_hash}{extension}"

    # Ensure upload directory exists
    settings = get_settings()
    upload_dir = Path(settings.UPLOAD_DIR)
    file_path = upload_dir / final_filename
    file_path.parent.mkdir(parents=True, exist_ok=True)

    # Save image file (async for non-blocking I/O)
    t1 = time.perf_counter()
    try:
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(image_data)
    except Exception as e:
        _raise_upload_error(UploadErrorCode.STORAGE_ERROR, f"Failed to save image: {e}")
    timings["file_write"] = (time.perf_counter() - t1) * 1000

    # Create screenshot record using INSERT ON CONFLICT (upsert)
    # This eliminates the separate duplicate check query
    t1 = time.perf_counter()
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    # Upsert: on duplicate file_path, reset processing state and reprocess
    insert_stmt = (
        pg_insert(Screenshot)
        .values(
            file_path=str(file_path),
            image_type=image_type,
            target_annotations=1,
            annotation_status=AnnotationStatus.PENDING,
            processing_status=ProcessingStatus.PENDING,
            current_annotation_count=0,
            participant_id=participant_id,
            group_id=group_id,
            source_id=source_id,
            device_type=detected_device_type,
            original_filepath=original_filepath,
            screenshot_date=screenshot_date,
            processing_metadata={"callback_url": callback_url} if callback_url else None,
        )
        .on_conflict_do_update(
            index_elements=["file_path"],
            set_={
                # Reset processing state
                "processing_status": ProcessingStatus.PENDING,
                "processing_method": None,
                # Clear OCR results for reprocessing
                "extracted_title": None,
                "extracted_total": None,
                "extracted_hourly_data": None,
                # Clear grid coords
                "grid_upper_left_x": None,
                "grid_upper_left_y": None,
                "grid_lower_right_x": None,
                "grid_lower_right_y": None,
                # Update metadata
                "device_type": detected_device_type,
                "original_filepath": original_filepath,
                "screenshot_date": screenshot_date,
                "processing_metadata": {"callback_url": callback_url, "reprocessed": True} if callback_url else {"reprocessed": True},
            },
        )
        .returning(Screenshot.id)
    )

    is_duplicate = False
    try:
        result = await db.execute(insert_stmt)
        row = result.fetchone()
        screenshot_id = row[0]

        # Check if this was a duplicate by checking for existing annotations
        # (If there are annotations, we need to clear them for a fresh start)
        from sqlalchemy import func
        annotation_count_result = await db.execute(
            select(func.count()).select_from(Annotation).where(Annotation.screenshot_id == screenshot_id)
        )
        annotation_count = annotation_count_result.scalar() or 0

        if annotation_count > 0:
            is_duplicate = True

            # Clear ALL existing data for fresh start
            # 1. Clear annotations
            await db.execute(delete(Annotation).where(Annotation.screenshot_id == screenshot_id))

            # 2. Clear consensus results
            await db.execute(delete(ConsensusResult).where(ConsensusResult.screenshot_id == screenshot_id))

            # 3. Clear user queue states for this screenshot
            await db.execute(delete(UserQueueState).where(UserQueueState.screenshot_id == screenshot_id))

            # 4. Reset all screenshot state
            await db.execute(
                update(Screenshot)
                .where(Screenshot.id == screenshot_id)
                .values(
                    current_annotation_count=0,
                    annotation_status=AnnotationStatus.PENDING,
                    has_consensus=False,
                    verified_by_user_ids=None,
                )
            )
            logger.info(f"Duplicate upload: cleared all data for screenshot {screenshot_id}, reprocessing")

        await db.commit()
    except Exception as e:
        await db.rollback()
        # Clean up saved file
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
        _raise_upload_error(UploadErrorCode.DATABASE_ERROR, f"Failed to create screenshot record: {e}")
    timings["db_insert"] = (time.perf_counter() - t1) * 1000

    # Queue background processing via Celery (fire and forget)
    t1 = time.perf_counter()
    processing_queued = False
    try:
        from screenshot_processor.web.tasks import process_screenshot_task

        process_screenshot_task.delay(screenshot_id)  # type: ignore[attr-defined]
        processing_queued = True
    except Exception as e:
        logger.warning(f"Failed to queue processing for screenshot {screenshot_id}: {e}")
    timings["celery_queue"] = (time.perf_counter() - t1) * 1000

    total_ms = (time.perf_counter() - t0) * 1000
    if total_ms > 100:  # Log slow uploads at INFO level
        logger.info(
            f"Slow upload {screenshot_id}: total={total_ms:.1f}ms "
            f"(file={timings.get('file_write', 0):.1f}ms db={timings.get('db_insert', 0):.1f}ms)"
        )
    else:
        logger.debug(
            f"Upload {screenshot_id} timing: total={total_ms:.1f}ms "
            f"hash={timings.get('hash', 0):.1f}ms "
            f"file={timings.get('file_write', 0):.1f}ms db={timings.get('db_insert', 0):.1f}ms "
            f"celery={timings.get('celery_queue', 0):.1f}ms"
        )

    return ScreenshotUploadResponse(
        success=True,
        screenshot_id=screenshot_id,
        group_created=group_created,
        message="Duplicate replaced and requeued for processing" if is_duplicate else None,
        duplicate=is_duplicate,
        file_path=str(file_path),
        file_size_bytes=len(image_data),
        image_dimensions=(width, height) if width > 0 else None,
        device_type_detected=detected_device_type,
        processing_queued=processing_queued,
        idempotency_key=idempotency_key,
    )


@router.post("/upload", response_model=ScreenshotUploadResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(lambda: get_settings().RATE_LIMIT_UPLOAD)
async def upload_screenshot(
    request: Request,
    upload_request: Annotated[ScreenshotUploadRequest, Body()],
    db: DatabaseSession,
    api_key: str = Header(..., alias="X-API-Key", description="API key for upload authorization"),
):
    """
    Upload a screenshot with base64-encoded image data.

    Features:
    - Base64-encoded PNG/JPEG images (max 100 MB)
    - Auto-detection of device type from image dimensions
    - SHA256 checksum verification (optional)
    - Idempotency key for safe retries
    - Callback URL for webhook notifications when processing completes
    - Groups auto-created if they don't exist
    - Duplicate detection by file hash

    Rate limit: 180 requests/minute

    Headers:
        X-API-Key: API key for authorization

    Returns:
        Extended metadata including file path, dimensions, and processing status
    """
    from screenshot_processor.web.database import UploadErrorCode

    settings = get_settings()

    # Validate API key
    if api_key != settings.UPLOAD_API_KEY:
        _raise_upload_error(UploadErrorCode.INVALID_API_KEY, "Invalid API key")

    # Validate callback URL if provided
    _validate_callback_url(upload_request.callback_url)

    logger.info(
        f"Upload request: group={upload_request.group_id}, participant={upload_request.participant_id}, "
        f"idempotency_key={upload_request.idempotency_key}"
    )

    # Decode and validate image
    image_data, extension, dimensions = _decode_and_validate_image(
        upload_request.screenshot,
        upload_request.sha256,
    )

    # Check/create group with upsert to handle concurrent requests
    group_created = False
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    insert_stmt = (
        pg_insert(Group)
        .values(
            id=upload_request.group_id,
            name=upload_request.group_id,
            image_type=upload_request.image_type,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )

    result = await db.execute(insert_stmt)
    group_created = result.rowcount > 0  # type: ignore[attr-defined]

    # Process the upload
    return await _process_single_upload(
        db=db,
        image_data=image_data,
        extension=extension,
        dimensions=dimensions,
        participant_id=upload_request.participant_id,
        group_id=upload_request.group_id,
        image_type=upload_request.image_type,
        device_type=upload_request.device_type,
        filename=upload_request.filename,
        source_id=upload_request.source_id,
        original_filepath=upload_request.original_filepath,
        screenshot_date=upload_request.screenshot_date,
        callback_url=upload_request.callback_url,
        idempotency_key=upload_request.idempotency_key,
        group_created=group_created,
    )


@router.post("/upload/batch", response_model=BatchUploadResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(lambda: get_settings().RATE_LIMIT_BATCH_UPLOAD)
async def upload_screenshots_batch(
    request: Request,
    batch_request: Annotated[BatchUploadRequest, Body()],
    db: DatabaseSession,
    api_key: str = Header(..., alias="X-API-Key", description="API key for upload authorization"),
):
    """
    Upload multiple screenshots in a single request.

    Features:
    - Upload up to 60 screenshots per batch
    - All screenshots share the same group_id and image_type
    - Individual SHA256 checksum verification per image
    - Partial success handling - failed items don't block successful ones
    - Callback URL for webhook notification when batch processing completes

    Rate limit: 30 batches/minute (separate from single upload limit)

    Headers:
        X-API-Key: API key for authorization

    Returns:
        Summary of batch results with individual item status
    """
    settings = get_settings()

    # Validate API key
    if api_key != settings.UPLOAD_API_KEY:
        _raise_upload_error(UploadErrorCode.INVALID_API_KEY, "Invalid API key")

    # Validate callback URL if provided
    _validate_callback_url(batch_request.callback_url)

    logger.info(
        f"Batch upload request: group={batch_request.group_id}, count={len(batch_request.screenshots)}, "
        f"idempotency_key={batch_request.idempotency_key}"
    )

    # Check/create group - must commit before parallel tasks start
    # because each parallel task has its own session and won't see uncommitted changes
    group_created = False
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    insert_stmt = (
        pg_insert(Group)
        .values(
            id=batch_request.group_id,
            name=batch_request.group_id,
            image_type=batch_request.image_type,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )

    result = await db.execute(insert_stmt)
    group_created = result.rowcount > 0  # type: ignore[attr-defined]
    await db.commit()  # Commit so parallel tasks can see the group

    # Optimized batch processing:
    # 1. Decode/validate all images in parallel
    # 2. Write all files in parallel
    # 3. Single bulk INSERT for all screenshots
    # 4. Queue Celery tasks in bulk
    import time

    t_start = time.perf_counter()
    timings = {}

    settings = get_settings()
    upload_dir = Path(settings.UPLOAD_DIR)

    # Phase 1: Decode and validate all images in parallel
    t1 = time.perf_counter()

    async def decode_item(idx: int, item):
        try:
            image_data, extension, dimensions = _decode_and_validate_image(
                item.screenshot,
                item.sha256,
            )
            return idx, image_data, extension, dimensions, None
        except HTTPException as e:
            return idx, None, None, None, e
        except Exception as e:
            return idx, None, None, None, e

    decode_results = await asyncio.gather(
        *[decode_item(idx, item) for idx, item in enumerate(batch_request.screenshots)]
    )
    timings["decode"] = (time.perf_counter() - t1) * 1000

    # Separate successful decodes from failures
    decoded_items: list[dict] = []
    results: list[BatchItemResult | None] = [None] * len(batch_request.screenshots)

    for idx, image_data, extension, dimensions, error in decode_results:
        if error:
            if isinstance(error, HTTPException):
                error_detail = error.detail if isinstance(error.detail, dict) else {"detail": str(error.detail)}
                raw_error_code = error_detail.get("error_code")
                # Convert string error code to enum if present
                error_code_enum = UploadErrorCode(raw_error_code) if raw_error_code else None
                results[idx] = BatchItemResult(
                    index=idx,
                    success=False,
                    error_code=error_code_enum,
                    error_detail=error_detail.get("detail", str(error.detail)),
                )
            else:
                results[idx] = BatchItemResult(
                    index=idx,
                    success=False,
                    error_code=UploadErrorCode.STORAGE_ERROR,
                    error_detail=str(error),
                )
        else:
            # No error means all values are valid (not None)
            assert image_data is not None
            assert extension is not None
            assert dimensions is not None
            item = batch_request.screenshots[idx]
            width, height = dimensions
            detected_device_type = batch_request.device_type
            if not detected_device_type and width > 0 and height > 0:
                detected_device_type = _detect_device_type(width, height)

            # Generate file path
            file_hash = hashlib.blake2b(image_data, digest_size=6).hexdigest()
            if item.filename:
                safe_filename = sanitize_filename(item.filename)
                base_name = Path(safe_filename).stem
                final_filename = f"{batch_request.group_id}/{item.participant_id}/{base_name}_{file_hash}{extension}"
            else:
                unique_id = str(uuid.uuid4())[:8]
                final_filename = f"{batch_request.group_id}/{item.participant_id}/{unique_id}_{file_hash}{extension}"

            file_path = upload_dir / final_filename
            decoded_items.append(
                {
                    "idx": idx,
                    "image_data": image_data,
                    "file_path": file_path,
                    "participant_id": item.participant_id,
                    "source_id": item.source_id,
                    "original_filepath": item.original_filepath,
                    "screenshot_date": item.screenshot_date,
                    "device_type": detected_device_type,
                }
            )

    # Phase 2: Write all files in parallel
    t1 = time.perf_counter()

    async def write_file(item_data):
        file_path = item_data["file_path"]
        file_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(item_data["image_data"])
            return item_data["idx"], True, None
        except Exception as e:
            return item_data["idx"], False, str(e)

    write_results = await asyncio.gather(*[write_file(item) for item in decoded_items])
    timings["file_write"] = (time.perf_counter() - t1) * 1000

    # Filter out write failures
    items_to_insert = []
    for idx, success, error in write_results:
        if not success:
            results[idx] = BatchItemResult(
                index=idx,
                success=False,
                error_code=UploadErrorCode.STORAGE_ERROR,
                error_detail=error,
            )
        else:
            # Find the decoded item data
            item_data = next(d for d in decoded_items if d["idx"] == idx)
            items_to_insert.append(item_data)

    # Phase 3: Bulk INSERT all screenshots
    t1 = time.perf_counter()
    inserted_ids = {}
    duplicate_paths: set[str] = set()

    if items_to_insert:
        # Check which paths already exist (for duplicate detection)
        all_paths = [str(item["file_path"]) for item in items_to_insert]
        existing_result = await db.execute(
            select(Screenshot.file_path).where(Screenshot.file_path.in_(all_paths))
        )
        duplicate_paths = {row[0] for row in existing_result.fetchall()}
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        values = [
            {
                "file_path": str(item["file_path"]),
                "image_type": batch_request.image_type,
                "target_annotations": 1,
                "annotation_status": AnnotationStatus.PENDING,
                "processing_status": ProcessingStatus.PENDING,
                "current_annotation_count": 0,
                "participant_id": item["participant_id"],
                "group_id": batch_request.group_id,
                "source_id": item["source_id"],
                "device_type": item["device_type"],
                "original_filepath": item["original_filepath"],
                "screenshot_date": item["screenshot_date"],
            }
            for item in items_to_insert
        ]

        # Bulk upsert: ON CONFLICT DO UPDATE to reset and reprocess duplicates
        insert_stmt = (
            pg_insert(Screenshot)
            .values(values)
            .on_conflict_do_update(
                index_elements=["file_path"],
                set_={
                    "processing_status": ProcessingStatus.PENDING,
                    "processing_method": None,
                    "extracted_title": None,
                    "extracted_total": None,
                    "extracted_hourly_data": None,
                    "grid_upper_left_x": None,
                    "grid_upper_left_y": None,
                    "grid_lower_right_x": None,
                    "grid_lower_right_y": None,
                    "processing_metadata": {"reprocessed": True},
                },
            )
            .returning(Screenshot.id, Screenshot.file_path)
        )

        try:
            result = await db.execute(insert_stmt)
            rows = result.fetchall()

            # Map file_path to id
            for row in rows:
                inserted_ids[row.file_path] = row.id

            # Clear all data for duplicates
            if duplicate_paths:
                dup_ids = [inserted_ids[fp] for fp in duplicate_paths]

                # Clear annotations, consensus, queue states for duplicates
                await db.execute(delete(Annotation).where(Annotation.screenshot_id.in_(dup_ids)))
                await db.execute(delete(ConsensusResult).where(ConsensusResult.screenshot_id.in_(dup_ids)))
                await db.execute(delete(UserQueueState).where(UserQueueState.screenshot_id.in_(dup_ids)))

                # Reset screenshot state
                await db.execute(
                    update(Screenshot)
                    .where(Screenshot.id.in_(dup_ids))
                    .values(
                        current_annotation_count=0,
                        annotation_status=AnnotationStatus.PENDING,
                        has_consensus=False,
                        verified_by_user_ids=None,
                    )
                )
                logger.info(f"Batch upload: cleared all data for {len(dup_ids)} duplicates, reprocessing")

            await db.commit()

        except Exception as e:
            await db.rollback()
            # Mark all as failed
            for item in items_to_insert:
                results[item["idx"]] = BatchItemResult(
                    index=item["idx"],
                    success=False,
                    error_code=UploadErrorCode.DATABASE_ERROR,
                    error_detail=str(e),
                )
            items_to_insert = []

    timings["db_insert"] = (time.perf_counter() - t1) * 1000

    # Phase 4: Queue Celery tasks and build results
    t1 = time.perf_counter()
    screenshot_ids_to_queue = []

    for item in items_to_insert:
        idx = item["idx"]
        fp = str(item["file_path"])
        screenshot_id = inserted_ids.get(fp)
        is_duplicate = fp in duplicate_paths

        if screenshot_id:
            results[idx] = BatchItemResult(
                index=idx,
                success=True,
                screenshot_id=screenshot_id,
                duplicate=is_duplicate,
            )
            # Queue ALL screenshots for processing (including duplicates which are now reset)
            screenshot_ids_to_queue.append(screenshot_id)

    # Queue all Celery tasks at once using group for efficiency
    if screenshot_ids_to_queue:
        try:
            from celery import group
            from screenshot_processor.web.tasks import process_screenshot_task

            # Create a group of tasks and send them all at once
            task_group = group(
                process_screenshot_task.s(sid) for sid in screenshot_ids_to_queue  # type: ignore[attr-defined]
            )
            task_group.apply_async()
        except Exception as e:
            logger.warning(f"Failed to queue processing tasks: {e}")

    timings["celery_queue"] = (time.perf_counter() - t1) * 1000

    total_ms = (time.perf_counter() - t_start) * 1000
    logger.info(
        f"Batch upload timing: total={total_ms:.1f}ms "
        f"decode={timings.get('decode', 0):.1f}ms file={timings.get('file_write', 0):.1f}ms "
        f"db={timings.get('db_insert', 0):.1f}ms celery={timings.get('celery_queue', 0):.1f}ms"
    )

    # Count results (filter out None values first)
    valid_results = [r for r in results if r is not None]
    successful_count = sum(1 for r in valid_results if r.success and not r.duplicate)
    duplicate_count = sum(1 for r in valid_results if r.success and r.duplicate)
    failed_count = sum(1 for r in valid_results if not r.success)

    logger.info(
        f"Batch upload completed: group={batch_request.group_id}, "
        f"success={successful_count}, failed={failed_count}, duplicates={duplicate_count}"
    )

    return BatchUploadResponse(
        success=failed_count == 0,
        total_count=len(batch_request.screenshots),
        successful_count=successful_count,
        failed_count=failed_count,
        duplicate_count=duplicate_count,
        group_created=group_created,
        results=valid_results,  # Already filtered for None
        idempotency_key=batch_request.idempotency_key,
    )


# ============================================================================
# Export Endpoints - Available to all authenticated users
# ============================================================================
# NOTE: JSON export removed - use CSV for large datasets (memory-efficient streaming)


@router.get("/export/csv", tags=["Export"])
async def export_consensus_csv(
    db: DatabaseSession,
    current_user: CurrentUser,
    group_id: str | None = Query(None, description="Filter by group ID"),
    verified_only: bool = Query(False, description="Only export screenshots verified by at least one user"),
    has_annotations: bool = Query(False, description="Only export screenshots with at least one annotation"),
    processing_status: str | None = Query(None, description="Filter by processing status (completed, failed, etc.)"),
):
    """
    Export consensus data as CSV.

    Returns CSV with screenshot info, consensus values, and hourly data.
    Available to all authenticated users.

    Filters:
    - group_id: Filter by group
    - verified_only: Only include screenshots that have been verified by at least one user
    - has_annotations: Only include screenshots with at least one annotation
    - processing_status: Filter by OCR processing status (completed, failed, pending, skipped)
    """
    import csv
    import io
    from datetime import datetime, timezone

    from fastapi.responses import StreamingResponse
    from sqlalchemy import and_

    logger.info(
        f"User {current_user.username} exported consensus data "
        f"(CSV, group={group_id}, verified_only={verified_only}, has_annotations={has_annotations})"
    )

    # Build query with filters
    conditions = []

    if group_id:
        conditions.append(Screenshot.group_id == group_id)

    if verified_only:
        # verified_by_user_ids is non-null, non-JSON-null, and non-empty array
        # Note: JSON columns can have SQL NULL or JSON null (literal "null" string)
        conditions.append(Screenshot.verified_by_user_ids.isnot(None))
        conditions.append(cast(Screenshot.verified_by_user_ids, String) != "null")
        conditions.append(cast(Screenshot.verified_by_user_ids, String) != "[]")

    if has_annotations:
        conditions.append(Screenshot.current_annotation_count > 0)

    if processing_status:
        conditions.append(Screenshot.processing_status == processing_status)

    stmt = select(Screenshot, ConsensusResult).outerjoin(
        ConsensusResult, Screenshot.id == ConsensusResult.screenshot_id
    )
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(Screenshot.uploaded_at)

    result = await db.execute(stmt)
    rows = result.all()

    output = io.StringIO()
    csv_writer = csv.writer(output)

    csv_writer.writerow(
        [
            "Screenshot ID",
            "Filename",
            "Original Filepath",
            "Group ID",
            "Participant ID",
            "Image Type",
            "Screenshot Date",
            "Uploaded At",
            "Processing Status",
            "Is Verified",
            "Verified By Count",
            "Annotation Count",
            "Has Consensus",
            "Consensus Total",
            "Disagreement Count",
            *[f"Hour {i}" for i in range(24)],
        ]
    )

    for screenshot, consensus in rows:
        hourly_values = [""] * 24
        consensus_total = ""
        disagreement_count = 0

        # Primary source: screenshot's extracted_hourly_data (single-rater workflow)
        # Fallback: consensus.consensus_values (multi-rater workflow)
        hourly_data_source = None
        if screenshot.extracted_hourly_data:
            hourly_data_source = screenshot.extracted_hourly_data
        elif consensus and consensus.consensus_values:
            hourly_data_source = consensus.consensus_values

        if hourly_data_source:
            total_minutes = 0
            for hour_str, value in hourly_data_source.items():
                try:
                    hour_idx = int(hour_str)
                    if 0 <= hour_idx < 24:
                        hourly_values[hour_idx] = str(value) if value is not None else ""
                        if value is not None:
                            total_minutes += float(value)
                except (ValueError, TypeError):
                    pass
            hours = int(total_minutes // 60)
            mins = int(total_minutes % 60)
            consensus_total = f"{hours}h {mins}m" if hours > 0 else f"{mins}m"

        # Count disagreements if consensus exists
        if consensus and consensus.disagreement_details:
            disagreement_count = sum(
                1
                for details in consensus.disagreement_details.values()
                if isinstance(details, dict) and details.get("has_disagreement", False)
            )

        verified_ids = screenshot.verified_by_user_ids or []
        csv_writer.writerow(
            [
                screenshot.id,
                screenshot.file_path.split("/")[-1] if screenshot.file_path else "",
                screenshot.original_filepath or "",
                screenshot.group_id or "",
                screenshot.participant_id or "",
                screenshot.image_type,
                screenshot.screenshot_date.isoformat() if screenshot.screenshot_date else "",
                screenshot.uploaded_at.isoformat(),
                screenshot.processing_status.value if screenshot.processing_status else "",
                "Yes" if verified_ids else "No",
                len(verified_ids),
                screenshot.current_annotation_count,
                "Yes" if screenshot.has_consensus else "No",
                consensus_total,
                disagreement_count,
                *hourly_values,
            ]
        )

    output.seek(0)
    filename = f"export_{group_id or 'all'}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
