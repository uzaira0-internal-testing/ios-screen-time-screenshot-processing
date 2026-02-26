"""Preprocessing routes for ZIP upload with PHI detection/redaction."""

from __future__ import annotations

import logging
import re
import uuid
import zipfile
from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select

from screenshot_processor.web.api.dependencies import CurrentUser, DatabaseSession
from screenshot_processor.web.config import get_settings
from screenshot_processor.web.database import (
    PreprocessingJob,
    PreprocessingJobListResponse,
    PreprocessingJobRead,
    PreprocessingJobStatus,
    PreprocessingUploadResponse,
)

logger = logging.getLogger(__name__)

# Pattern for safe group/participant IDs: alphanumeric, underscore, hyphen, dot, space
SAFE_ID_PATTERN = re.compile(r"^[\w\-. ]+$")

router = APIRouter(prefix="/preprocessing", tags=["Preprocessing"])

# Maximum ZIP file size: 1GB
MAX_ZIP_SIZE = 1024 * 1024 * 1024


@router.post("/upload-zip", response_model=PreprocessingUploadResponse)
async def upload_zip_for_preprocessing(
    db: DatabaseSession,
    current_user: CurrentUser,
    file: Annotated[UploadFile, File(description="ZIP file containing screenshots")],
    group_id: Annotated[str, Form(description="Group ID for uploaded screenshots")],
    redaction_method: Annotated[str, Form(description="PHI redaction method")] = "redbox",
    detection_preset: Annotated[str, Form(description="PHI detection preset")] = "hipaa_compliant",
):
    """
    Upload a ZIP file of screenshots for preprocessing with PHI detection/redaction.

    The ZIP should have structure: {participant_id}/{date}/*.png

    Processing is done asynchronously via Celery. Poll the job status endpoint
    to track progress.
    """
    settings = get_settings()

    # Validate group_id format (prevent XSS via group names)
    if not SAFE_ID_PATTERN.match(group_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="group_id must contain only alphanumeric characters, underscores, hyphens, dots, and spaces",
        )

    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a ZIP archive",
        )

    # Check if user already has an active job
    active_job_query = select(PreprocessingJob).where(
        PreprocessingJob.user_id == current_user.id,
        PreprocessingJob.status.in_([
            PreprocessingJobStatus.PENDING,
            PreprocessingJobStatus.EXTRACTING,
            PreprocessingJobStatus.DETECTING,
            PreprocessingJobStatus.CROPPING,
            PreprocessingJobStatus.PHI_DETECTION,
            PreprocessingJobStatus.REDACTING,
            PreprocessingJobStatus.UPLOADING,
        ]),
    )
    result = await db.execute(active_job_query)
    active_job = result.scalar_one_or_none()

    if active_job:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You already have an active preprocessing job: {active_job.id}",
        )

    # Create job ID and paths
    job_id = str(uuid.uuid4())
    upload_dir = Path(settings.UPLOAD_DIR) / "preprocessing" / job_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    zip_path = upload_dir / "upload.zip"

    # Save ZIP file to disk (streaming to avoid memory issues)
    try:
        total_size = 0
        async with aiofiles.open(zip_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):  # 1MB chunks
                total_size += len(chunk)
                if total_size > MAX_ZIP_SIZE:
                    # Clean up partial file
                    zip_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"ZIP file exceeds maximum size of {MAX_ZIP_SIZE // (1024*1024)}MB",
                    )
                await f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to save ZIP file", extra={"error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file",
        )

    # Validate ZIP file
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            # Count image files
            image_files = [
                name for name in zf.namelist()
                if name.lower().endswith((".png", ".jpg", ".jpeg"))
                and not name.startswith("__MACOSX")
                and not name.startswith(".")
            ]
            total_images = len(image_files)

            if total_images == 0:
                zip_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="ZIP file contains no valid image files (PNG, JPG, JPEG)",
                )
    except zipfile.BadZipFile:
        zip_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid ZIP file",
        )

    # Create job record
    job = PreprocessingJob(
        id=job_id,
        user_id=current_user.id,
        status=PreprocessingJobStatus.PENDING,
        total_images=total_images,
        group_id=group_id,
        redaction_method=redaction_method,
        detection_preset=detection_preset,
        zip_file_path=str(zip_path),
    )
    db.add(job)
    await db.commit()

    # Queue Celery task
    try:
        from screenshot_processor.web.tasks import preprocess_zip_task

        preprocess_zip_task.delay(job_id)
        logger.info("Queued preprocessing job", extra={"job_id": job_id, "total_images": total_images})
    except Exception as e:
        logger.error("Failed to queue preprocessing task", extra={"job_id": job_id, "error": str(e)})
        # Update job status to failed
        job.status = PreprocessingJobStatus.FAILED
        job.errors = [{"type": "queue_error", "message": str(e)}]
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to queue preprocessing task",
        )

    return PreprocessingUploadResponse(
        job_id=job_id,
        status=job.status.value,
        message=f"Queued {total_images} images for preprocessing",
    )


@router.get("/jobs", response_model=PreprocessingJobListResponse)
async def list_preprocessing_jobs(
    db: DatabaseSession,
    current_user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """List preprocessing jobs for the current user."""
    query = (
        select(PreprocessingJob)
        .where(PreprocessingJob.user_id == current_user.id)
        .order_by(PreprocessingJob.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    jobs = result.scalars().all()

    # Get total count
    count_query = select(PreprocessingJob).where(PreprocessingJob.user_id == current_user.id)
    count_result = await db.execute(count_query)
    total = len(count_result.scalars().all())

    return PreprocessingJobListResponse(
        jobs=[PreprocessingJobRead.model_validate(job) for job in jobs],
        total=total,
    )


@router.get("/jobs/{job_id}", response_model=PreprocessingJobRead)
async def get_preprocessing_job(
    job_id: str,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    """Get status of a preprocessing job."""
    query = select(PreprocessingJob).where(
        PreprocessingJob.id == job_id,
        PreprocessingJob.user_id == current_user.id,
    )
    result = await db.execute(query)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Preprocessing job not found",
        )

    return PreprocessingJobRead.model_validate(job)


@router.delete("/jobs/{job_id}")
async def cancel_preprocessing_job(
    job_id: str,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    """Cancel a preprocessing job (if still pending) or delete a completed job."""
    query = select(PreprocessingJob).where(
        PreprocessingJob.id == job_id,
        PreprocessingJob.user_id == current_user.id,
    )
    result = await db.execute(query)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Preprocessing job not found",
        )

    # If job is in progress, mark as cancelled
    if job.status in [
        PreprocessingJobStatus.PENDING,
        PreprocessingJobStatus.EXTRACTING,
        PreprocessingJobStatus.DETECTING,
        PreprocessingJobStatus.CROPPING,
        PreprocessingJobStatus.PHI_DETECTION,
        PreprocessingJobStatus.REDACTING,
        PreprocessingJobStatus.UPLOADING,
    ]:
        job.status = PreprocessingJobStatus.CANCELLED
        await db.commit()
        return {"message": "Job cancelled", "job_id": job_id}

    # If job is completed/failed/cancelled, delete it
    await db.delete(job)
    await db.commit()

    # Clean up files
    if job.zip_file_path:
        zip_path = Path(job.zip_file_path)
        if zip_path.exists():
            zip_path.unlink(missing_ok=True)
        # Try to remove parent directory if empty
        try:
            zip_path.parent.rmdir()
        except OSError:
            pass  # Directory not empty or doesn't exist

    return {"message": "Job deleted", "job_id": job_id}
