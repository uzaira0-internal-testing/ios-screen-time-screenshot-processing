"""
Celery tasks for background processing.

Thin wrappers around the processing service.
"""

import logging
import os
from datetime import datetime, timezone

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from screenshot_processor.web.celery_app import celery_app
from screenshot_processor.web.database.models import ProcessingStatus, Screenshot
from screenshot_processor.web.services.processing_service import process_screenshot_sync

# Task timeout settings (in seconds)
SOFT_TIME_LIMIT = 60  # Raise exception after 60s
HARD_TIME_LIMIT = 90  # Kill task after 90s (fallback)

logger = logging.getLogger(__name__)

# Sync database connection for Celery workers
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://screenshot:screenshot@localhost:5433/screenshot_annotations",
)
SYNC_DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")

engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=SOFT_TIME_LIMIT,
    time_limit=HARD_TIME_LIMIT,
)
def process_screenshot_task(self, screenshot_id: int, max_shift: int = 5) -> dict:
    """Process a screenshot with grid optimization."""
    logger.info(f"Processing screenshot {screenshot_id} with max_shift={max_shift}")

    db = SessionLocal()
    try:
        screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
        if not screenshot:
            return {"success": False, "error": "Screenshot not found"}

        # Record when processing actually starts (for timing metrics)
        screenshot.processing_started_at = datetime.now(timezone.utc)
        db.commit()

        result = process_screenshot_sync(db, screenshot, max_shift=max_shift)
        return {"success": True, "screenshot_id": screenshot_id, "processing_status": result["processing_status"]}

    except SoftTimeLimitExceeded:
        # Task timed out - mark as FAILED so it doesn't stay stuck in PROCESSING
        logger.error(f"Screenshot {screenshot_id} timed out after {SOFT_TIME_LIMIT}s")
        try:
            screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
            if screenshot:
                screenshot.processing_status = ProcessingStatus.FAILED
                screenshot.processing_issues = [f"Processing timed out after {SOFT_TIME_LIMIT} seconds"]
                screenshot.processed_at = datetime.now(timezone.utc)
                db.commit()
                logger.info(f"Marked screenshot {screenshot_id} as FAILED due to timeout")
        except Exception as db_err:
            logger.error(f"Failed to mark screenshot {screenshot_id} as FAILED: {db_err}")
        return {"success": False, "error": "timeout", "screenshot_id": screenshot_id}

    except Exception as e:
        db.rollback()
        logger.error(f"Error processing screenshot {screenshot_id}: {e}")
        try:
            self.retry(exc=e)
        except self.MaxRetriesExceededError:
            # Mark screenshot as FAILED so it doesn't stay stuck in PENDING
            try:
                screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
                if screenshot:
                    screenshot.processing_status = ProcessingStatus.FAILED
                    screenshot.processing_issues = [f"Max retries exceeded: {str(e)}"]
                    db.commit()
                    logger.info(f"Marked screenshot {screenshot_id} as FAILED after max retries")
            except Exception as db_err:
                logger.error(f"Failed to mark screenshot {screenshot_id} as FAILED: {db_err}")
            return {"success": False, "error": str(e), "max_retries_exceeded": True}
    finally:
        db.close()


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=SOFT_TIME_LIMIT,
    time_limit=HARD_TIME_LIMIT,
)
def reprocess_screenshot_task(
    self, screenshot_id: int, processing_method: str | None = None, max_shift: int = 5
) -> dict:
    """Reprocess a screenshot with optional specific method and grid optimization."""
    logger.info(f"Reprocessing screenshot {screenshot_id} with method={processing_method}, max_shift={max_shift}")

    db = SessionLocal()
    try:
        screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
        if not screenshot:
            return {"success": False, "error": "Screenshot not found"}

        # Record when processing actually starts (for timing metrics)
        screenshot.processing_started_at = datetime.now(timezone.utc)
        db.commit()

        result = process_screenshot_sync(
            db, screenshot, processing_method=processing_method, max_shift=max_shift
        )
        return {"success": True, "screenshot_id": screenshot_id, "processing_status": result["processing_status"]}

    except SoftTimeLimitExceeded:
        # Task timed out - mark as FAILED so it doesn't stay stuck in PROCESSING
        logger.error(f"Screenshot {screenshot_id} timed out after {SOFT_TIME_LIMIT}s")
        try:
            screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
            if screenshot:
                screenshot.processing_status = ProcessingStatus.FAILED
                screenshot.processing_issues = [f"Processing timed out after {SOFT_TIME_LIMIT} seconds"]
                screenshot.processed_at = datetime.now(timezone.utc)
                db.commit()
                logger.info(f"Marked screenshot {screenshot_id} as FAILED due to timeout")
        except Exception as db_err:
            logger.error(f"Failed to mark screenshot {screenshot_id} as FAILED: {db_err}")
        return {"success": False, "error": "timeout", "screenshot_id": screenshot_id}

    except Exception as e:
        db.rollback()
        logger.error(f"Error reprocessing screenshot {screenshot_id}: {e}")
        try:
            self.retry(exc=e)
        except self.MaxRetriesExceededError:
            # Mark screenshot as FAILED so it doesn't stay stuck in PENDING
            try:
                screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
                if screenshot:
                    screenshot.processing_status = ProcessingStatus.FAILED
                    screenshot.processing_issues = [f"Max retries exceeded: {str(e)}"]
                    db.commit()
                    logger.info(f"Marked screenshot {screenshot_id} as FAILED after max retries")
            except Exception as db_err:
                logger.error(f"Failed to mark screenshot {screenshot_id} as FAILED: {db_err}")
            return {"success": False, "error": str(e), "max_retries_exceeded": True}
    finally:
        db.close()


@celery_app.task
def health_check() -> dict:
    """Health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
