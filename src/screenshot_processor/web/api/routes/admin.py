import logging
from pathlib import Path

import cv2
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from screenshot_processor.core.image_utils import convert_dark_mode
from screenshot_processor.core.ocr import find_screenshot_total_usage
from screenshot_processor.web.api.dependencies import CurrentUser, DatabaseSession
from screenshot_processor.web.database.models import UserRole
from screenshot_processor.web.rate_limiting import ADMIN_DESTRUCTIVE_RATE_LIMIT, limiter
from screenshot_processor.web.database import (
    Annotation,
    ConsensusResult,
    DeleteGroupResponse,
    Group,
    ResetTestDataResponse,
    Screenshot,
    User,
    UserQueueState,
    UserStatsRead,
    UserUpdateResponse,
)
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
async def get_all_users(db: DatabaseSession, admin: User = AdminUser):
    """Get all users with their annotation statistics. Admin only.

    Uses a single query with LEFT JOIN to avoid N+1 problem.
    """
    # Single query with aggregation - avoids N+1 problem
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
    result = await db.execute(stmt)
    rows = result.all()

    return [
        UserStatsRead(
            id=row.User.id,
            username=row.User.username,
            email=row.User.email,
            role=row.User.role,
            is_active=row.User.is_active,
            created_at=row.User.created_at.isoformat(),
            annotations_count=row.annotations_count,
            avg_time_spent_seconds=round(float(row.avg_time), 2),
        )
        for row in rows
    ]


@router.put("/users/{user_id}", response_model=UserUpdateResponse)
async def update_user(
    user_id: int,
    db: DatabaseSession,
    is_active: bool | None = None,
    role: str | None = None,
    admin: User = AdminUser,
):
    """Update user status or role. Admin only."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    try:
        old_role = user.role
        old_active = user.is_active

        if is_active is not None:
            user.is_active = is_active

        if role is not None:
            if role not in ["annotator", "admin"]:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
            user.role = role

        await db.commit()
        await db.refresh(user)

        # Audit logging
        if role is not None and role != old_role:
            logger.info(f"AUDIT: Admin {admin.username} changed user {user.username} role from {old_role} to {role}")
        if is_active is not None and is_active != old_active:
            status_str = "activated" if is_active else "deactivated"
            logger.info(f"AUDIT: Admin {admin.username} {status_str} user {user.username}")

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
        await db.rollback()
        logger.error(f"Failed to update user {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user",
        )


# ============================================================================
# Test Data Reset - Admin Only (for e2e tests)
# ============================================================================


@router.post("/reset-test-data", response_model=ResetTestDataResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def reset_test_data(request: Request, db: DatabaseSession, admin: User = AdminUser):
    """
    Reset test data for e2e testing.
    Clears user queue states and annotations to allow fresh test runs.
    Admin only.
    """
    from screenshot_processor.web.database import AnnotationStatus, Screenshot

    try:
        # Clear all user queue states (skipped screenshots)
        await db.execute(select(UserQueueState).execution_options(synchronize_session="fetch"))
        from sqlalchemy import delete

        await db.execute(delete(UserQueueState))

        # Clear all annotations
        await db.execute(delete(Annotation))

        # Reset screenshot annotation counts
        result = await db.execute(select(Screenshot))
        screenshots = result.scalars().all()
        for screenshot in screenshots:
            screenshot.current_annotation_count = 0
            screenshot.annotation_status = AnnotationStatus.PENDING
            screenshot.has_consensus = False
            screenshot.verified_by_user_ids = None

        await db.commit()

        logger.info(f"AUDIT: Admin {admin.username} reset test data")

        return ResetTestDataResponse(success=True, message="Test data reset successfully")

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to reset test data: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reset test data: {str(e)}",
        )


# ============================================================================
# Group Management - Admin Only
# ============================================================================


@router.delete("/groups/{group_id}", response_model=DeleteGroupResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def delete_group(
    request: Request,
    group_id: str,
    db: DatabaseSession,
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
    from sqlalchemy import delete

    try:
        # Check if group exists
        result = await db.execute(select(Group).where(Group.id == group_id))
        group = result.scalar_one_or_none()

        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Group '{group_id}' not found",
            )

        # Get all screenshot IDs in this group
        screenshots_result = await db.execute(select(Screenshot.id).where(Screenshot.group_id == group_id))
        screenshot_ids = [row[0] for row in screenshots_result.fetchall()]

        screenshots_count = len(screenshot_ids)
        annotations_count = 0

        if screenshot_ids:
            # Delete all related records for these screenshots
            # 1. Delete annotations
            annotations_result = await db.execute(
                delete(Annotation).where(Annotation.screenshot_id.in_(screenshot_ids))
            )
            annotations_count = annotations_result.rowcount

            # 2. Delete consensus results
            consensus_result = await db.execute(
                delete(ConsensusResult).where(ConsensusResult.screenshot_id.in_(screenshot_ids))
            )
            consensus_count = consensus_result.rowcount

            # 3. Delete user queue states
            queue_result = await db.execute(
                delete(UserQueueState).where(UserQueueState.screenshot_id.in_(screenshot_ids))
            )
            queue_count = queue_result.rowcount

            logger.info(
                f"Cleaning up group '{group_id}': {annotations_count} annotations, "
                f"{consensus_count} consensus results, {queue_count} queue states"
            )

            # 4. Delete all screenshots in this group
            await db.execute(delete(Screenshot).where(Screenshot.group_id == group_id))

        # Delete the group itself
        await db.execute(delete(Group).where(Group.id == group_id))

        await db.commit()

        logger.info(
            f"AUDIT: Admin {admin.username} deleted group '{group_id}' "
            f"({screenshots_count} screenshots, {annotations_count} annotations)"
        )

        return DeleteGroupResponse(
            success=True,
            group_id=group_id,
            screenshots_deleted=screenshots_count,
            annotations_deleted=annotations_count,
            message=f"Group '{group_id}' deleted successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to delete group '{group_id}': {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete group: {str(e)}",
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
    db: DatabaseSession,
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
        # Find screenshots missing extracted_total (only screen_time type)
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

        result = await db.execute(query)
        screenshots = result.scalars().all()

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
                    logger.warning(f"Screenshot {screenshot.id}: File not found at {file_path}")
                    failed += 1
                    continue

                # Read and process the image
                img = cv2.imread(file_path)
                if img is None:
                    logger.warning(f"Screenshot {screenshot.id}: Could not read image at {file_path}")
                    failed += 1
                    continue

                # Convert dark mode if needed
                img = convert_dark_mode(img)

                # Extract the total using OCR
                total, _ = find_screenshot_total_usage(img)

                if total and total.strip():
                    screenshot.extracted_total = total.strip()
                    updated += 1
                    logger.info(f"Screenshot {screenshot.id}: Extracted total = '{total.strip()}'")
                else:
                    logger.info(f"Screenshot {screenshot.id}: No total found")

            except Exception as e:
                logger.error(f"Screenshot {screenshot.id}: Error extracting total - {e}")
                failed += 1

        await db.commit()

        logger.info(
            f"AUDIT: Admin {admin.username} recalculated OCR totals: "
            f"{processed} processed, {updated} updated, {failed} failed"
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
        await db.rollback()
        logger.error(f"Failed to recalculate OCR totals: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to recalculate OCR totals: {str(e)}",
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
        logger.debug(f"Cleaned up old reprocess status: {key}")


async def _bulk_reprocess_task(
    group_id: str,
    screenshot_ids: list[int],
    processing_method: str | None,
):
    """Background task to reprocess screenshots."""
    import asyncio

    from screenshot_processor.web.database import async_session_maker

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
                # Fetch the screenshot object
                result = await db.execute(select(Screenshot).where(Screenshot.id == screenshot_id))
                screenshot = result.scalar_one_or_none()
                if screenshot is None:
                    logger.warning(f"Screenshot {screenshot_id} not found")
                    _bulk_reprocess_status[status_key].failed += 1
                    continue

                await reprocess_screenshot(
                    db=db,
                    screenshot=screenshot,
                    processing_method=processing_method,
                )
                _bulk_reprocess_status[status_key].succeeded += 1
        except Exception as e:
            logger.error(f"Failed to reprocess screenshot {screenshot_id}: {e}")
            _bulk_reprocess_status[status_key].failed += 1
        finally:
            _bulk_reprocess_status[status_key].processed += 1
            # Yield control to event loop to allow other requests to be processed
            await asyncio.sleep(0)

    import time

    _bulk_reprocess_status[status_key].in_progress = False
    _bulk_reprocess_status[status_key].completed_at = time.time()
    logger.info(
        f"Bulk reprocess complete for {group_id}: "
        f"{_bulk_reprocess_status[status_key].succeeded} succeeded, "
        f"{_bulk_reprocess_status[status_key].failed} failed"
    )


@router.post("/bulk-reprocess", response_model=BulkReprocessResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def bulk_reprocess_screenshots(
    request: Request,
    db: DatabaseSession,
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
        # Find screenshots to reprocess
        query = select(Screenshot.id).where(
            Screenshot.image_type == "screen_time",
        )

        if group_id:
            query = query.where(Screenshot.group_id == group_id)

        query = query.limit(limit)

        result = await db.execute(query)
        screenshot_ids = [row[0] for row in result.fetchall()]

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
            reprocess_screenshot_task.s(sid, processing_method, max_shift)
            for sid in screenshot_ids
        )
        task_group.apply_async()

        logger.info(
            f"AUDIT: Admin {admin.username} queued bulk reprocess via Celery: "
            f"{len(screenshot_ids)} screenshots, group={group_id}, method={processing_method}, max_shift={max_shift}"
        )

        return BulkReprocessResponse(
            success=True,
            queued=len(screenshot_ids),
            message=f"Queued {len(screenshot_ids)} screenshots for Celery reprocessing (max_shift={max_shift})",
        )

    except Exception as e:
        logger.error(f"Failed to queue bulk reprocess: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to queue bulk reprocess: {str(e)}",
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
    db: DatabaseSession,
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
    from datetime import datetime, timezone
    from sqlalchemy import update
    from screenshot_processor.web.database import ProcessingStatus

    try:
        # Count current stuck screenshots
        pending_query = select(func.count(Screenshot.id)).where(
            Screenshot.processing_status == ProcessingStatus.PENDING,
        )
        processing_query = select(func.count(Screenshot.id)).where(
            Screenshot.processing_status == ProcessingStatus.PROCESSING,
        )

        if group_id:
            pending_query = pending_query.where(Screenshot.group_id == group_id)
            processing_query = processing_query.where(Screenshot.group_id == group_id)

        pending_result = await db.execute(pending_query)
        pending_count = pending_result.scalar() or 0

        processing_result = await db.execute(processing_query)
        processing_count = processing_result.scalar() or 0

        marked_failed = 0

        # Step 1: Mark PROCESSING screenshots as FAILED (they're orphaned)
        if mark_processing_as_failed and processing_count > 0:
            update_query = (
                update(Screenshot)
                .where(Screenshot.processing_status == ProcessingStatus.PROCESSING)
                .values(
                    processing_status=ProcessingStatus.FAILED,
                    processing_issues=["Marked as failed by admin: stuck in PROCESSING status"],
                    processed_at=datetime.now(timezone.utc),
                )
            )
            if group_id:
                update_query = update_query.where(Screenshot.group_id == group_id)

            result = await db.execute(update_query)
            marked_failed = result.rowcount
            await db.commit()

            logger.info(f"Marked {marked_failed} stuck PROCESSING screenshots as FAILED")

        # Step 2: Get all PENDING screenshot IDs and requeue them
        ids_query = select(Screenshot.id).where(
            Screenshot.processing_status == ProcessingStatus.PENDING,
        )
        if group_id:
            ids_query = ids_query.where(Screenshot.group_id == group_id)

        ids_result = await db.execute(ids_query)
        screenshot_ids = [row[0] for row in ids_result.fetchall()]

        requeued = 0
        if screenshot_ids:
            from celery import group as celery_group
            from screenshot_processor.web.tasks import process_screenshot_task

            task_group = celery_group(
                process_screenshot_task.s(sid) for sid in screenshot_ids
            )
            task_group.apply_async()
            requeued = len(screenshot_ids)

            logger.info(f"Requeued {requeued} PENDING screenshots to Celery")

        logger.info(
            f"AUDIT: Admin {admin.username} retried stuck screenshots: "
            f"group={group_id}, pending={pending_count}, processing={processing_count}, "
            f"marked_failed={marked_failed}, requeued={requeued}"
        )

        return RetryStuckResponse(
            success=True,
            pending_count=pending_count,
            processing_count=processing_count,
            requeued=requeued,
            marked_failed=marked_failed,
            message=f"Marked {marked_failed} as failed, requeued {requeued} pending screenshots",
        )

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to retry stuck screenshots: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retry stuck screenshots: {str(e)}",
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
async def find_orphaned_entries(db: DatabaseSession, admin: User = AdminUser):
    """
    Find orphaned database entries that reference non-existent screenshots.
    Admin only.
    """
    from sqlalchemy import not_

    # Find annotations referencing non-existent screenshots
    orphaned_annotations_result = await db.execute(
        select(func.count(Annotation.id)).where(
            not_(Annotation.screenshot_id.in_(select(Screenshot.id)))
        )
    )
    orphaned_annotations = orphaned_annotations_result.scalar() or 0

    # Find consensus results referencing non-existent screenshots
    orphaned_consensus_result = await db.execute(
        select(func.count(ConsensusResult.id)).where(
            not_(ConsensusResult.screenshot_id.in_(select(Screenshot.id)))
        )
    )
    orphaned_consensus = orphaned_consensus_result.scalar() or 0

    # Find queue states referencing non-existent screenshots
    orphaned_queue_result = await db.execute(
        select(func.count(UserQueueState.id)).where(
            not_(UserQueueState.screenshot_id.in_(select(Screenshot.id)))
        )
    )
    orphaned_queue_states = orphaned_queue_result.scalar() or 0

    # Find screenshots with no group
    screenshots_no_group_result = await db.execute(
        select(func.count(Screenshot.id)).where(Screenshot.group_id.is_(None))
    )
    screenshots_without_group = screenshots_no_group_result.scalar() or 0

    return OrphanedEntriesResponse(
        orphaned_annotations=orphaned_annotations,
        orphaned_consensus=orphaned_consensus,
        orphaned_queue_states=orphaned_queue_states,
        screenshots_without_group=screenshots_without_group,
    )


@router.post("/cleanup-orphaned", response_model=CleanupResponse)
@limiter.limit(ADMIN_DESTRUCTIVE_RATE_LIMIT)
async def cleanup_orphaned_entries(request: Request, db: DatabaseSession, admin: User = AdminUser):
    """
    Delete orphaned database entries that reference non-existent screenshots.
    Admin only.
    """
    from sqlalchemy import delete, not_

    try:
        # Delete orphaned annotations
        result1 = await db.execute(
            delete(Annotation).where(
                not_(Annotation.screenshot_id.in_(select(Screenshot.id)))
            )
        )
        deleted_annotations = result1.rowcount

        # Delete orphaned consensus results
        result2 = await db.execute(
            delete(ConsensusResult).where(
                not_(ConsensusResult.screenshot_id.in_(select(Screenshot.id)))
            )
        )
        deleted_consensus = result2.rowcount

        # Delete orphaned queue states
        result3 = await db.execute(
            delete(UserQueueState).where(
                not_(UserQueueState.screenshot_id.in_(select(Screenshot.id)))
            )
        )
        deleted_queue_states = result3.rowcount

        await db.commit()

        logger.info(
            f"AUDIT: Admin {admin.username} cleaned up orphaned entries: "
            f"{deleted_annotations} annotations, {deleted_consensus} consensus, "
            f"{deleted_queue_states} queue states"
        )

        return CleanupResponse(
            success=True,
            deleted_annotations=deleted_annotations,
            deleted_consensus=deleted_consensus,
            deleted_queue_states=deleted_queue_states,
            message=f"Cleaned up {deleted_annotations + deleted_consensus + deleted_queue_states} orphaned entries",
        )

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to cleanup orphaned entries: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cleanup: {str(e)}",
        )
