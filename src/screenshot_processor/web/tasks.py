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


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def preprocess_screenshot_task(
    self,
    screenshot_id: int,
    max_shift: int = 5,
    phi_pipeline_preset: str | None = None,
    phi_redaction_method: str | None = None,
    phi_detection_enabled: bool | None = None,
    run_ocr_after: bool = True,
) -> dict:
    """Preprocess a screenshot (device detection, cropping, PHI redaction) then optionally chain into OCR processing.

    Args:
        screenshot_id: Screenshot ID to preprocess
        max_shift: Max pixels to shift grid boundaries for OCR optimization
        phi_pipeline_preset: Override PHI pipeline preset (fast/balanced/hipaa_compliant/thorough)
        phi_redaction_method: Override PHI redaction method (redbox/blackbox/pixelate)
        phi_detection_enabled: Override whether to run PHI detection
        run_ocr_after: Whether to chain into OCR processing after preprocessing (default True)
    """
    logger.info(f"Preprocessing screenshot {screenshot_id}")

    db = SessionLocal()
    try:
        screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
        if not screenshot:
            return {"success": False, "error": "Screenshot not found"}

        from screenshot_processor.web.services.preprocessing_service import preprocess_screenshot_sync

        # Build override kwargs
        overrides = {}
        if phi_pipeline_preset is not None:
            overrides["phi_pipeline_preset"] = phi_pipeline_preset
        if phi_redaction_method is not None:
            overrides["phi_redaction_method"] = phi_redaction_method
        if phi_detection_enabled is not None:
            overrides["phi_detection_enabled"] = phi_detection_enabled

        preprocess_result = preprocess_screenshot_sync(db, screenshot, **overrides)

        if not preprocess_result.get("success"):
            logger.warning(
                f"Preprocessing failed for screenshot {screenshot_id}: {preprocess_result.get('skip_reason')}"
            )
            # Still proceed to OCR with original image if run_ocr_after is True

        # Determine which file path to use for OCR processing
        # If preprocessing produced a new file, use it; otherwise use original
        preprocessed_path = preprocess_result.get("preprocessed_file_path")
        if preprocessed_path:
            # Update screenshot file_path to point to preprocessed image for OCR
            # Keep original path in processing_metadata (already stored by preprocess_screenshot_sync)
            screenshot.file_path = preprocessed_path
            db.commit()

        if not run_ocr_after:
            return {
                "success": True,
                "screenshot_id": screenshot_id,
                "processing_status": screenshot.processing_status.value if hasattr(screenshot.processing_status, "value") else str(screenshot.processing_status),
                "preprocessing": preprocess_result,
            }

        # Chain into OCR processing
        result = process_screenshot_sync(db, screenshot, max_shift=max_shift)
        return {
            "success": True,
            "screenshot_id": screenshot_id,
            "processing_status": result["processing_status"],
            "preprocessing": preprocess_result,
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Error preprocessing screenshot {screenshot_id}: {e}")
        try:
            self.retry(exc=e)
        except self.MaxRetriesExceededError:
            return {"success": False, "error": str(e), "max_retries_exceeded": True}
    finally:
        db.close()


# =============================================================================
# Individual preprocessing stage tasks (composable pipeline)
# =============================================================================

PREPROCESSING_SOFT_LIMIT = 120  # 2 minutes
PREPROCESSING_HARD_LIMIT = 180  # 3 minutes


@celery_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    soft_time_limit=30,
    time_limit=60,
)
def device_detection_task(self, screenshot_id: int) -> dict:
    """Run device detection stage only."""
    from sqlalchemy.orm.attributes import flag_modified

    from screenshot_processor.web.services.preprocessing_service import (
        append_error_event,
        append_event,
        detect_device,
        get_current_input_file,
        init_preprocessing_metadata,
        set_stage_running,
    )

    logger.info(f"Device detection for screenshot {screenshot_id}")
    db = SessionLocal()
    try:
        screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
        if not screenshot:
            return {"success": False, "error": "Screenshot not found"}

        init_preprocessing_metadata(screenshot)
        set_stage_running(screenshot, "device_detection")
        flag_modified(screenshot, "processing_metadata")
        db.commit()

        input_file = get_current_input_file(screenshot, "device_detection")
        device = detect_device(input_file)

        result_data = {
            "detected": device.detected,
            "device_category": device.device_category,
            "device_model": device.device_model,
            "confidence": device.confidence,
            "is_ipad": device.is_ipad,
            "is_iphone": device.is_iphone,
            "orientation": device.orientation,
            "width": device.width,
            "height": device.height,
        }

        # Update device_type on the screenshot model
        if device.detected:
            if device.is_ipad:
                screenshot.device_type = "ipad"
            elif device.is_iphone:
                screenshot.device_type = "iphone"

        append_event(screenshot, "device_detection", "auto", {}, result_data, input_file=input_file)
        flag_modified(screenshot, "processing_metadata")
        db.commit()

        return {"success": True, "screenshot_id": screenshot_id, "stage": "device_detection"}

    except Exception as e:
        db.rollback()
        logger.error(f"Device detection failed for screenshot {screenshot_id}: {e}")
        try:
            screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
            if screenshot:
                init_preprocessing_metadata(screenshot)
                append_error_event(screenshot, "device_detection", "auto", {}, str(e))
                flag_modified(screenshot, "processing_metadata")
                db.commit()
        except Exception:
            pass
        return {"success": False, "error": str(e), "screenshot_id": screenshot_id}
    finally:
        db.close()


@celery_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    soft_time_limit=60,
    time_limit=90,
)
def cropping_task(self, screenshot_id: int) -> dict:
    """Run cropping stage only."""
    from pathlib import Path

    from sqlalchemy.orm.attributes import flag_modified

    from screenshot_processor.web.services.preprocessing_service import (
        append_error_event,
        append_event,
        crop_screenshot_if_ipad,
        detect_device,
        get_current_input_file,
        get_next_version,
        get_stage_output_path,
        init_preprocessing_metadata,
        set_stage_running,
    )

    logger.info(f"Cropping for screenshot {screenshot_id}")
    db = SessionLocal()
    try:
        screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
        if not screenshot:
            return {"success": False, "error": "Screenshot not found"}

        pp = init_preprocessing_metadata(screenshot)
        set_stage_running(screenshot, "cropping")
        flag_modified(screenshot, "processing_metadata")
        db.commit()

        input_file = get_current_input_file(screenshot, "cropping")
        base_path = pp["base_file_path"]

        # Read image bytes
        image_bytes = Path(input_file).read_bytes()

        # Get device info from current events or run detection
        current_events = pp.get("current_events", {})
        dd_eid = current_events.get("device_detection")
        device_info = None
        if dd_eid:
            dd_event = next((e for e in pp["events"] if e["event_id"] == dd_eid), None)
            if dd_event:
                device_info = dd_event.get("result", {})

        # Build a minimal DeviceDetectionResult for crop function
        from screenshot_processor.web.services.preprocessing_service import DeviceDetectionResult

        if device_info:
            device = DeviceDetectionResult(
                detected=device_info.get("detected", False),
                device_category=device_info.get("device_category", "unknown"),
                device_model=device_info.get("device_model"),
                confidence=device_info.get("confidence", 0.0),
                is_ipad=device_info.get("is_ipad", False),
                is_iphone=device_info.get("is_iphone", False),
                orientation=device_info.get("orientation", "unknown"),
                width=device_info.get("width", 0),
                height=device_info.get("height", 0),
            )
        else:
            device = detect_device(input_file)

        cropped_bytes, was_cropped, was_patched = crop_screenshot_if_ipad(image_bytes, device)

        output_file = None
        if was_cropped:
            version = get_next_version(screenshot, "cropping")
            output_path = get_stage_output_path(base_path, "cropping", version)
            output_path.write_bytes(cropped_bytes)
            output_file = str(output_path)

        result_data = {
            "was_cropped": was_cropped,
            "was_patched": was_patched,
            "is_ipad": device.is_ipad,
        }
        if was_cropped and device:
            result_data["original_dimensions"] = [device.width, device.height]

        params = {"auto_detected_device": device.device_category}

        append_event(
            screenshot, "cropping", "auto", params, result_data,
            output_file=output_file, input_file=input_file,
        )
        flag_modified(screenshot, "processing_metadata")
        db.commit()

        return {"success": True, "screenshot_id": screenshot_id, "stage": "cropping"}

    except Exception as e:
        db.rollback()
        logger.error(f"Cropping failed for screenshot {screenshot_id}: {e}")
        try:
            screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
            if screenshot:
                init_preprocessing_metadata(screenshot)
                append_error_event(screenshot, "cropping", "auto", {}, str(e))
                flag_modified(screenshot, "processing_metadata")
                db.commit()
        except Exception:
            pass
        return {"success": False, "error": str(e), "screenshot_id": screenshot_id}
    finally:
        db.close()


@celery_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    soft_time_limit=PREPROCESSING_SOFT_LIMIT,
    time_limit=PREPROCESSING_HARD_LIMIT,
)
def phi_detection_task(self, screenshot_id: int, preset: str = "hipaa_compliant") -> dict:
    """Run PHI detection stage only."""
    from pathlib import Path

    from sqlalchemy.orm.attributes import flag_modified

    from screenshot_processor.web.services.preprocessing_service import (
        append_error_event,
        append_event,
        detect_phi,
        get_current_input_file,
        init_preprocessing_metadata,
        serialize_phi_regions,
        set_stage_running,
    )

    logger.info(f"PHI detection for screenshot {screenshot_id} with preset={preset}")
    db = SessionLocal()
    try:
        screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
        if not screenshot:
            return {"success": False, "error": "Screenshot not found"}

        init_preprocessing_metadata(screenshot)
        set_stage_running(screenshot, "phi_detection")
        flag_modified(screenshot, "processing_metadata")
        db.commit()

        input_file = get_current_input_file(screenshot, "phi_detection")
        image_bytes = Path(input_file).read_bytes()

        detection = detect_phi(image_bytes, preset=preset)

        result_data = {
            "phi_detected": detection.phi_detected,
            "regions_count": detection.regions_count,
            "preset": preset,
            "regions": serialize_phi_regions(detection.regions),
        }

        append_event(
            screenshot, "phi_detection", "auto", {"preset": preset}, result_data,
            input_file=input_file,
        )
        flag_modified(screenshot, "processing_metadata")
        db.commit()

        return {"success": True, "screenshot_id": screenshot_id, "stage": "phi_detection"}

    except Exception as e:
        db.rollback()
        logger.error(f"PHI detection failed for screenshot {screenshot_id}: {e}")
        try:
            screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
            if screenshot:
                init_preprocessing_metadata(screenshot)
                append_error_event(screenshot, "phi_detection", "auto", {"preset": preset}, str(e))
                flag_modified(screenshot, "processing_metadata")
                db.commit()
        except Exception:
            pass
        return {"success": False, "error": str(e), "screenshot_id": screenshot_id}
    finally:
        db.close()


@celery_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    soft_time_limit=60,
    time_limit=90,
)
def phi_redaction_task(self, screenshot_id: int, method: str = "redbox") -> dict:
    """Run PHI redaction stage only."""
    from pathlib import Path

    from sqlalchemy.orm.attributes import flag_modified

    from screenshot_processor.web.services.preprocessing_service import (
        append_error_event,
        append_event,
        get_current_input_file,
        get_next_version,
        get_stage_output_path,
        init_preprocessing_metadata,
        redact_phi,
        set_stage_running,
    )

    logger.info(f"PHI redaction for screenshot {screenshot_id} with method={method}")
    db = SessionLocal()
    try:
        screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
        if not screenshot:
            return {"success": False, "error": "Screenshot not found"}

        pp = init_preprocessing_metadata(screenshot)
        set_stage_running(screenshot, "phi_redaction")
        flag_modified(screenshot, "processing_metadata")
        db.commit()

        # Get regions from current PHI detection event
        current_events = pp.get("current_events", {})
        phi_eid = current_events.get("phi_detection")
        if not phi_eid:
            # No PHI detection event — nothing to redact
            append_event(
                screenshot, "phi_redaction", "auto", {"method": method},
                {"redacted": False, "regions_redacted": 0, "reason": "no_phi_detection"},
                input_file=get_current_input_file(screenshot, "phi_redaction"),
            )
            flag_modified(screenshot, "processing_metadata")
            db.commit()
            return {"success": True, "screenshot_id": screenshot_id, "stage": "phi_redaction"}

        phi_event = next((e for e in pp["events"] if e["event_id"] == phi_eid), None)
        regions = phi_event.get("result", {}).get("regions", []) if phi_event else []

        input_file = get_current_input_file(screenshot, "phi_redaction")
        image_bytes = Path(input_file).read_bytes()

        redaction = redact_phi(image_bytes, regions, redaction_method=method)

        output_file = None
        if redaction.regions_redacted > 0:
            base_path = pp["base_file_path"]
            version = get_next_version(screenshot, "phi_redaction")
            output_path = get_stage_output_path(base_path, "phi_redaction", version)
            output_path.write_bytes(redaction.image_bytes)
            output_file = str(output_path)

        result_data = {
            "redacted": redaction.regions_redacted > 0,
            "regions_redacted": redaction.regions_redacted,
            "method": method,
            "phi_detected": phi_event.get("result", {}).get("phi_detected", False) if phi_event else False,
        }

        append_event(
            screenshot, "phi_redaction", "auto",
            {"method": method, "input_event_id": phi_eid},
            result_data, output_file=output_file, input_file=input_file,
        )
        flag_modified(screenshot, "processing_metadata")
        db.commit()

        return {"success": True, "screenshot_id": screenshot_id, "stage": "phi_redaction"}

    except Exception as e:
        db.rollback()
        logger.error(f"PHI redaction failed for screenshot {screenshot_id}: {e}")
        try:
            screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
            if screenshot:
                init_preprocessing_metadata(screenshot)
                append_error_event(screenshot, "phi_redaction", "auto", {"method": method}, str(e))
                flag_modified(screenshot, "processing_metadata")
                db.commit()
        except Exception:
            pass
        return {"success": False, "error": str(e), "screenshot_id": screenshot_id}
    finally:
        db.close()


@celery_app.task
def health_check() -> dict:
    """Health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
