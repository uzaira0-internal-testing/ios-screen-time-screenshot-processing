"""
Celery tasks for background processing.

Thin wrappers around the processing service.
"""

import logging
import os
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from screenshot_processor.web.celery_app import celery_app
from screenshot_processor.web.database.models import Screenshot
from screenshot_processor.web.services.processing_service import process_screenshot_sync

logger = logging.getLogger(__name__)

# Sync database connection for Celery workers
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://screenshot:screenshot@localhost:5433/screenshot_annotations",
)
SYNC_DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")

engine = create_engine(SYNC_DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_screenshot_task(self, screenshot_id: int, max_shift: int = 5) -> dict:
    """Process a screenshot with grid optimization."""
    logger.info(f"Processing screenshot {screenshot_id} with max_shift={max_shift}")

    db = SessionLocal()
    try:
        screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
        if not screenshot:
            return {"success": False, "error": "Screenshot not found"}

        result = process_screenshot_sync(db, screenshot, max_shift=max_shift)
        return {"success": True, "screenshot_id": screenshot_id, "processing_status": result["processing_status"]}

    except Exception as e:
        db.rollback()
        logger.error(f"Error processing screenshot {screenshot_id}: {e}")
        try:
            self.retry(exc=e)
        except self.MaxRetriesExceededError:
            return {"success": False, "error": str(e), "max_retries_exceeded": True}
    finally:
        db.close()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
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

        result = process_screenshot_sync(
            db, screenshot, processing_method=processing_method, max_shift=max_shift
        )
        return {"success": True, "screenshot_id": screenshot_id, "processing_status": result["processing_status"]}

    except Exception as e:
        db.rollback()
        logger.error(f"Error reprocessing screenshot {screenshot_id}: {e}")
        try:
            self.retry(exc=e)
        except self.MaxRetriesExceededError:
            return {"success": False, "error": str(e), "max_retries_exceeded": True}
    finally:
        db.close()


@celery_app.task
def health_check() -> dict:
    """Health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
