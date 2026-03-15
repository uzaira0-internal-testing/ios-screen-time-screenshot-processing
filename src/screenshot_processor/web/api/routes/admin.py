import logging
from pathlib import Path

import cv2
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from screenshot_processor.core.image_utils import convert_dark_mode
from screenshot_processor.core.ocr import find_screenshot_total_usage
from screenshot_processor.web.api.dependencies import CurrentUser
from screenshot_processor.web.database import (
    DeleteGroupResponse,
    ResetTestDataResponse,
    User,
    UserStatsRead,
    UserUpdateResponse,
)
from screenshot_processor.web.database.models import UserRole
from screenshot_processor.web.rate_limiting import ADMIN_DESTRUCTIVE_RATE_LIMIT, limiter
from screenshot_processor.web.repositories import AdminRepo
from screenshot_processor.web.services import reprocess_screenshot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])


async def require_admin(current_user: CurrentUser) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


AdminUser = Depends(require_admin)


# ============================================================================
# User Management - Admin Only
# ============================================================================


@router.get("/users", response_model=list[UserStatsRead])
async def get_all_users(repo: AdminRepo, admin: User = AdminUser):
    """Get all users with their annotation statistics. Admin only.

    Uses a single query with LEFT JOIN to avoid N+1 problem.
    """
    rows = await repo.get_users_with_stats()

    return [
        UserStatsRead(
            id=row.user.id,
            username=row.user.username,
            email=row.user.email,
            role=row.user.role,
            is_active=row.user.is_active,
            created_at=row.user.created_at.isoformat(),
            annotations_count=row.annotations_count,
            avg_time_spent_seconds=row.avg_time_spent_seconds,
        )
        for row in rows
    ]


@router.put("/users/{user_id}", response_model=UserUpdateResponse)
async def update_user(
    user_id: int,
    repo: AdminRepo,
    is_active: bool | None = None,
    role: str | None = None,
    admin: User = AdminUser,
):
    """Update user status or role. Admin only."""
    user = await repo.get_user_by_id(user_id)

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    try:
        old_role = user.role
        old_active = user.is_active

        if role is not None and role not in ["annotator", "admin"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

        user = await repo.update_user(user, is_active=is_active, role=role)

        # Audit logging
        if role is not None and role != old_role:
            logger.info(
                "Admin changed user role",
                extra={
                    "audit": True,
                    "admin_username": admin.username,
                    "username": user.username,
                    "old_role": str(old_role),
                    "new_role": role,
                },
            )
        if is_active is not None and is_active != old_active:
            status_str = "activated" if is_active else "deactivated"
            logger.info(
                "Admin changed user status",
                extra={
                    "audit": True,
                    "admin_username": admin.username,
                    "username": user.username,
                    "action": status_str,
                },
            )

        return UserUpdateResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            role=user.role,
            is_active=user.is_active,
        )

    except HTTPException:
        raise
    except Exception as e:
        await repo.db.rollback()
        logger.error("Failed to update user", extra={"user_id": user_id, "error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user",
        )


# ============================================================================
# Test Data Reset - Admin Only (for e2e tests)
# ============================================================================


@router.post("/reset-test-data", response_model=ResetTestDataResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def reset_test_data(request: Request, repo: AdminRepo, admin: User = AdminUser):
    """
    Reset test data for e2e testing.
    Clears user queue states and annotations to allow fresh test runs.
    Admin only.
    """
    try:
        await repo.reset_test_data()

        logger.info("Admin reset test data", extra={"audit": True, "admin_username": admin.username})

        return ResetTestDataResponse(success=True, message="Test data reset successfully")

    except Exception as e:
        await repo.db.rollback()
        logger.error("Failed to reset test data", extra={"error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reset test data: {e!s}",
        )


# ============================================================================
# Group Management - Admin Only
# ============================================================================


@router.delete("/groups/{group_id}", response_model=DeleteGroupResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def delete_group(
    request: Request,
    group_id: str,
    repo: AdminRepo,
    admin: User = AdminUser,
):
    """
    Delete a group and all its screenshots (hard delete).
    This is a destructive operation that permanently removes:
    - All screenshots in the group
    - All annotations for those screenshots
    - The group itself

    Admin only.
    """
    try:
        # Check if group exists
        group = await repo.get_group_by_id(group_id)

        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Group '{group_id}' not found",
            )

        # Get screenshot IDs first
        screenshot_ids = await repo.get_screenshot_ids_for_group(group_id)

        # Cascade delete all DB rows
        counts = await repo.delete_group_cascade(group_id, screenshot_ids)

        logger.info(
            "Admin deleted group",
            extra={
                "audit": True,
                "admin_username": admin.username,
                "group_id": group_id,
                "screenshots_deleted": counts.screenshots_deleted,
                "annotations_deleted": counts.annotations_deleted,
            },
        )

        return DeleteGroupResponse(
            success=True,
            group_id=group_id,
            screenshots_deleted=counts.screenshots_deleted,
            annotations_deleted=counts.annotations_deleted,
            message=f"Group '{group_id}' deleted successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        await repo.db.rollback()
        logger.error("Failed to delete group", extra={"group_id": group_id, "error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete group: {e!s}",
        )


# ============================================================================
# OCR Total Recalculation - Admin Only
# ============================================================================


class RecalculateOcrTotalResponse(BaseModel):
    success: bool
    total_missing: int
    processed: int
    updated: int
    failed: int
    message: str


@router.post("/recalculate-ocr-totals", response_model=RecalculateOcrTotalResponse)
async def recalculate_ocr_totals(
    repo: AdminRepo,
    admin: User = AdminUser,
    limit: int = Query(default=100, ge=1, le=1000, description="Max screenshots to process"),
    group_id: str | None = Query(default=None, description="Filter by group ID"),
):
    """
    Recalculate OCR totals for screen_time screenshots that are missing extracted_total.
    This runs OCR on the original image to extract the total usage time.

    Admin only.
    """
    try:
        screenshots = await repo.get_screenshots_missing_ocr_total(group_id=group_id, limit=limit)

        total_missing = len(screenshots)
        processed = 0
        updated = 0
        failed = 0

        for screenshot in screenshots:
            processed += 1
            try:
                # Load the image
                file_path = screenshot.file_path
                if not Path(file_path).exists():
                    logger.warning(
                        "Screenshot file not found", extra={"screenshot_id": screenshot.id, "file_path": file_path}
                    )
                    failed += 1
                    continue

                # Read and process the image
                img = cv2.imread(file_path)
                if img is None:
                    logger.warning(
                        "Could not read screenshot image",
                        extra={"screenshot_id": screenshot.id, "file_path": file_path},
                    )
                    failed += 1
                    continue

                # Convert dark mode if needed
                img = convert_dark_mode(img)

                # Extract the total using OCR
                total, _ = find_screenshot_total_usage(img)

                if total and total.strip():
                    screenshot.extracted_total = total.strip()
                    updated += 1
                    logger.info(
                        "Extracted OCR total", extra={"screenshot_id": screenshot.id, "extracted_total": total.strip()}
                    )
                else:
                    logger.info("No OCR total found", extra={"screenshot_id": screenshot.id})

            except Exception as e:
                logger.error("Error extracting OCR total", extra={"screenshot_id": screenshot.id, "error": str(e)})
                failed += 1

        await repo.db.commit()

        logger.info(
            "Admin recalculated OCR totals",
            extra={
                "audit": True,
                "admin_username": admin.username,
                "processed": processed,
                "updated": updated,
                "failed": failed,
            },
        )

        return RecalculateOcrTotalResponse(
            success=True,
            total_missing=total_missing,
            processed=processed,
            updated=updated,
            failed=failed,
            message=f"Processed {processed} screenshots: {updated} updated, {failed} failed",
        )

    except Exception as e:
        await repo.db.rollback()
        logger.error("Failed to recalculate OCR totals", extra={"error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to recalculate OCR totals: {e!s}",
        )


# ============================================================================
# Bulk Reprocess - Admin Only
# ============================================================================


class BulkReprocessResponse(BaseModel):
    success: bool
    queued: int
    message: str


class BulkReprocessStatus(BaseModel):
    total: int
    processed: int
    succeeded: int
    failed: int
    in_progress: bool
    completed_at: float | None = None  # Unix timestamp when job finished


# Global status tracker for bulk reprocess with TTL cleanup
_bulk_reprocess_status: dict[str, BulkReprocessStatus] = {}
_BULK_REPROCESS_TTL_SECONDS = 3600  # Keep completed entries for 1 hour


def _cleanup_old_reprocess_status() -> None:
    """Remove completed reprocess status entries older than TTL."""
    import time

    current_time = time.time()
    keys_to_remove = [
        key
        for key, status in _bulk_reprocess_status.items()
        if status.completed_at is not None and (current_time - status.completed_at) > _BULK_REPROCESS_TTL_SECONDS
    ]
    for key in keys_to_remove:
        del _bulk_reprocess_status[key]
        logger.debug("Cleaned up old reprocess status", extra={"status_key": key})


async def _bulk_reprocess_task(
    group_id: str,
    screenshot_ids: list[int],
    processing_method: str | None,
):
    """Background task to reprocess screenshots."""
    import asyncio

    from screenshot_processor.web.database import async_session_maker
    from screenshot_processor.web.repositories import ScreenshotRepository

    status_key = f"reprocess_{group_id}"
    _bulk_reprocess_status[status_key] = BulkReprocessStatus(
        total=len(screenshot_ids),
        processed=0,
        succeeded=0,
        failed=0,
        in_progress=True,
    )

    for screenshot_id in screenshot_ids:
        try:
            async with async_session_maker() as db:
                screenshot_repo = ScreenshotRepository(db)
                # Fetch the screenshot object
                screenshot = await screenshot_repo.get_by_id(screenshot_id)
                if screenshot is None:
                    logger.warning("Screenshot not found for reprocessing", extra={"screenshot_id": screenshot_id})
                    _bulk_reprocess_status[status_key].failed += 1
                    continue

                await reprocess_screenshot(
                    db=db,
                    screenshot=screenshot,
                    processing_method=processing_method,
                )
                _bulk_reprocess_status[status_key].succeeded += 1
        except Exception as e:
            logger.error("Failed to reprocess screenshot", extra={"screenshot_id": screenshot_id, "error": str(e)})
            _bulk_reprocess_status[status_key].failed += 1
        finally:
            _bulk_reprocess_status[status_key].processed += 1
            # Yield control to event loop to allow other requests to be processed
            await asyncio.sleep(0)

    import time

    _bulk_reprocess_status[status_key].in_progress = False
    _bulk_reprocess_status[status_key].completed_at = time.time()
    logger.info(
        "Bulk reprocess complete",
        extra={
            "group_id": group_id,
            "succeeded": _bulk_reprocess_status[status_key].succeeded,
            "failed": _bulk_reprocess_status[status_key].failed,
        },
    )


@router.post("/bulk-reprocess", response_model=BulkReprocessResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def bulk_reprocess_screenshots(
    request: Request,
    repo: AdminRepo,
    admin: User = AdminUser,
    group_id: str | None = Query(default=None, description="Filter by group ID"),
    processing_method: str | None = Query(default=None, description="Processing method: 'ocr' or 'line_based'"),
    max_shift: int = Query(default=5, ge=0, le=10, description="Max pixels to shift grid for optimization"),
    limit: int = Query(default=1000, ge=1, le=5000, description="Max screenshots to reprocess"),
):
    """
    Queue screenshots for reprocessing via Celery workers.

    This will reprocess all screen_time screenshots in the specified group
    (or all groups if not specified) using the updated processing code.
    Uses Celery for background processing to avoid blocking the API.

    Admin only.
    """
    try:
        screenshot_ids = await repo.get_screenshot_ids_for_reprocess(group_id=group_id, limit=limit)

        if not screenshot_ids:
            return BulkReprocessResponse(
                success=True,
                queued=0,
                message="No screenshots found to reprocess",
            )

        # Queue Celery tasks for each screenshot (non-blocking)
        from celery import group as celery_group

        from screenshot_processor.web.tasks import reprocess_screenshot_task

        task_group = celery_group(
            reprocess_screenshot_task.s(sid, processing_method, max_shift) for sid in screenshot_ids
        )
        task_group.apply_async()

        logger.info(
            "Admin queued bulk reprocess via Celery",
            extra={
                "audit": True,
                "admin_username": admin.username,
                "count": len(screenshot_ids),
                "group_id": group_id,
                "processing_method": processing_method,
                "max_shift": max_shift,
            },
        )

        return BulkReprocessResponse(
            success=True,
            queued=len(screenshot_ids),
            message=f"Queued {len(screenshot_ids)} screenshots for Celery reprocessing (max_shift={max_shift})",
        )

    except Exception as e:
        logger.error("Failed to queue bulk reprocess", extra={"error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to queue bulk reprocess: {e!s}",
        )


@router.get("/bulk-reprocess/status", response_model=BulkReprocessStatus | None)
async def get_bulk_reprocess_status(
    admin: User = AdminUser,
    group_id: str | None = Query(default=None, description="Group ID to check status for"),
):
    """Get the status of a bulk reprocess operation. Admin only."""
    # Clean up old status entries to prevent memory leak
    _cleanup_old_reprocess_status()

    status_key = f"reprocess_{group_id or 'all'}"
    return _bulk_reprocess_status.get(status_key)


# ============================================================================
# Retry Stuck Screenshots - Admin Only
# ============================================================================


class RetryStuckResponse(BaseModel):
    success: bool
    pending_count: int
    processing_count: int
    requeued: int
    marked_failed: int
    message: str


@router.post("/retry-stuck", response_model=RetryStuckResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def retry_stuck_screenshots(
    request: Request,
    repo: AdminRepo,
    admin: User = AdminUser,
    group_id: str | None = Query(default=None, description="Filter by group ID"),
    mark_processing_as_failed: bool = Query(
        default=True,
        description="Mark screenshots stuck in PROCESSING as FAILED before requeuing PENDING ones",
    ),
):
    """
    Retry screenshots stuck in PENDING or PROCESSING status.

    This endpoint:
    1. Optionally marks all PROCESSING screenshots as FAILED (they're stuck/orphaned)
    2. Requeues all PENDING screenshots to Celery for processing

    Use this when screenshots are stuck and not being processed by Celery workers.
    Admin only.
    """
    try:
        # Count current stuck screenshots
        stuck_counts = await repo.count_stuck_screenshots(group_id=group_id)

        marked_failed = 0

        # Step 1: Mark PROCESSING screenshots as FAILED (they're orphaned)
        if mark_processing_as_failed and stuck_counts.processing_count > 0:
            marked_failed = await repo.mark_processing_as_failed(group_id=group_id)
            logger.info("Marked stuck PROCESSING screenshots as FAILED", extra={"count": marked_failed})

        # Step 2: Get all PENDING screenshot IDs and requeue them
        screenshot_ids = await repo.get_pending_screenshot_ids(group_id=group_id)

        requeued = 0
        if screenshot_ids:
            from celery import group as celery_group

            from screenshot_processor.web.tasks import process_screenshot_task

            task_group = celery_group(process_screenshot_task.s(sid) for sid in screenshot_ids)
            task_group.apply_async()
            requeued = len(screenshot_ids)

            logger.info("Requeued PENDING screenshots to Celery", extra={"count": requeued})

        logger.info(
            "Admin retried stuck screenshots",
            extra={
                "audit": True,
                "admin_username": admin.username,
                "group_id": group_id,
                "pending_count": stuck_counts.pending_count,
                "processing_count": stuck_counts.processing_count,
                "marked_failed": marked_failed,
                "requeued": requeued,
            },
        )

        return RetryStuckResponse(
            success=True,
            pending_count=stuck_counts.pending_count,
            processing_count=stuck_counts.processing_count,
            requeued=requeued,
            marked_failed=marked_failed,
            message=f"Marked {marked_failed} as failed, requeued {requeued} pending screenshots",
        )

    except Exception as e:
        await repo.db.rollback()
        logger.error("Failed to retry stuck screenshots", extra={"error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retry stuck screenshots: {e!s}",
        )


# ============================================================================
# Database Cleanup - Admin Only
# ============================================================================


class OrphanedEntriesResponse(BaseModel):
    orphaned_annotations: int
    orphaned_consensus: int
    orphaned_queue_states: int
    screenshots_without_group: int


class CleanupResponse(BaseModel):
    success: bool
    deleted_annotations: int
    deleted_consensus: int
    deleted_queue_states: int
    message: str


@router.get("/orphaned-entries", response_model=OrphanedEntriesResponse)
async def find_orphaned_entries(repo: AdminRepo, admin: User = AdminUser):
    """
    Find orphaned database entries that reference non-existent screenshots.
    Admin only.
    """
    counts = await repo.find_orphaned_entries()

    return OrphanedEntriesResponse(
        orphaned_annotations=counts.orphaned_annotations,
        orphaned_consensus=counts.orphaned_consensus,
        orphaned_queue_states=counts.orphaned_queue_states,
        screenshots_without_group=counts.screenshots_without_group,
    )


@router.post("/cleanup-orphaned", response_model=CleanupResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def cleanup_orphaned_entries(request: Request, repo: AdminRepo, admin: User = AdminUser):
    """
    Delete orphaned database entries that reference non-existent screenshots.
    Admin only.
    """
    try:
        counts = await repo.cleanup_orphaned_entries()

        logger.info(
            "Admin cleaned up orphaned entries",
            extra={
                "audit": True,
                "admin_username": admin.username,
                "deleted_annotations": counts.deleted_annotations,
                "deleted_consensus": counts.deleted_consensus,
                "deleted_queue_states": counts.deleted_queue_states,
            },
        )

        return CleanupResponse(
            success=True,
            deleted_annotations=counts.deleted_annotations,
            deleted_consensus=counts.deleted_consensus,
            deleted_queue_states=counts.deleted_queue_states,
            message=f"Cleaned up {counts.deleted_annotations + counts.deleted_consensus + counts.deleted_queue_states} orphaned entries",
        )

    except Exception as e:
        await repo.db.rollback()
        logger.error("Failed to cleanup orphaned entries", extra={"error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cleanup: {e!s}",
        )
