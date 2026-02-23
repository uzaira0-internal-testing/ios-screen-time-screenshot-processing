"""
Screenshot preprocessing service.

Wraps three external packages for preprocessing iOS screenshots:
1. ios-device-detector - iPhone vs iPad classification
2. ipad-screenshot-cropper - Remove iPad sidebar
3. phi-detector-remover - Detect and redact PHI (Protected Health Information)

Each package import is guarded by try/except ImportError so the service
degrades gracefully when packages aren't installed.

Architecture:
1. preprocess_screenshot_file() - Core sync function, no DB
2. preprocess_screenshot_sync() - Sync wrapper for Celery (commits to DB)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# =============================================================================
# Result dataclasses
# =============================================================================


@dataclass
class DeviceDetectionResult:
    """Result of iOS device detection."""

    detected: bool
    device_category: str  # iphone, ipad, unknown
    device_model: str | None
    confidence: float
    is_ipad: bool
    is_iphone: bool
    orientation: str  # portrait, landscape, unknown
    width: int = 0
    height: int = 0


@dataclass
class PHIDetectionResult:
    """Result of PHI detection (without redaction)."""

    phi_detected: bool
    regions_count: int
    regions: list[Any] = field(default_factory=list)
    detector_results: dict[str, float] = field(default_factory=dict)


@dataclass
class PHIRedactionResult:
    """Result of PHI redaction."""

    image_bytes: bytes
    regions_redacted: int
    redaction_method: str


@dataclass
class PreprocessingResult:
    """Result of full preprocessing pipeline."""

    success: bool
    image_bytes: bytes | None
    device_detection: DeviceDetectionResult | None
    was_cropped: bool
    was_patched: bool
    phi_detected: bool
    phi_regions_count: int
    phi_redacted: bool
    skip_reason: str | None


# =============================================================================
# Individual preprocessing stages
# =============================================================================


def detect_device(image_path: Path | str) -> DeviceDetectionResult:
    """Detect iOS device type from screenshot dimensions.

    Uses ios-device-detector if installed, falls back to unknown.
    """
    image_path = Path(image_path)

    try:
        from ios_device_detector import DeviceDetector

        detector = DeviceDetector()
        result = detector.detect_from_file(str(image_path))

        width = 0
        height = 0
        if result.detected_dimensions:
            width = result.detected_dimensions.width
            height = result.detected_dimensions.height

        return DeviceDetectionResult(
            detected=result.detected,
            device_category=result.device_category.value if hasattr(result.device_category, "value") else str(result.device_category),
            device_model=result.device_model,
            confidence=result.confidence,
            is_ipad=result.is_ipad,
            is_iphone=result.is_iphone,
            orientation=result.orientation.value if hasattr(result.orientation, "value") else str(result.orientation),
            width=width,
            height=height,
        )
    except ImportError:
        logger.debug("ios-device-detector not installed, skipping device detection")
        return DeviceDetectionResult(
            detected=False,
            device_category="unknown",
            device_model=None,
            confidence=0.0,
            is_ipad=False,
            is_iphone=False,
            orientation="unknown",
        )
    except Exception as e:
        logger.warning(f"Device detection failed: {e}")
        return DeviceDetectionResult(
            detected=False,
            device_category="unknown",
            device_model=f"error: {e}",
            confidence=0.0,
            is_ipad=False,
            is_iphone=False,
            orientation="unknown",
        )


def crop_screenshot_if_ipad(
    image_bytes: bytes,
    device: DeviceDetectionResult,
) -> tuple[bytes, bool, bool]:
    """Crop iPad sidebar if needed. Returns (bytes, was_cropped, was_patched)."""
    try:
        import cv2
        import numpy as np
        from ipad_screenshot_cropper import crop_screenshot, should_process_image

        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes, False, False

        check = should_process_image(img)
        if not check.should_process:
            return image_bytes, False, False

        result = crop_screenshot(image_bytes, device=check.device)
        _, buffer = cv2.imencode(".png", result.cropped_image)
        cropped_bytes = buffer.tobytes()
        return cropped_bytes, True, result.was_patched

    except ImportError:
        logger.debug("ipad-screenshot-cropper not installed, skipping cropping")
        return image_bytes, False, False
    except Exception as e:
        logger.warning(f"iPad cropping failed: {e}")
        return image_bytes, False, False


def detect_phi(
    image_bytes: bytes,
    preset: str = "hipaa_compliant",
) -> PHIDetectionResult:
    """Detect PHI regions in an image.

    Args:
        image_bytes: Image data
        preset: Pipeline preset (fast/balanced/hipaa_compliant/thorough)
    """
    try:
        from phi_detector_remover import PHIPipelineBuilder

        builders = {
            "fast": PHIPipelineBuilder.fast,
            "balanced": PHIPipelineBuilder.balanced,
            "hipaa_compliant": PHIPipelineBuilder.hipaa_compliant,
            "thorough": PHIPipelineBuilder.thorough,
        }
        builder_fn = builders.get(preset, PHIPipelineBuilder.hipaa_compliant)
        pipeline = builder_fn().build()
        result = pipeline.process(image_bytes)

        # PipelineResult API: .has_phi, .region_count, .aggregated_regions, .get_regions_for_redaction()
        regions = result.get_regions_for_redaction()

        detector_results: dict[str, float] = {}
        for region in regions:
            detector_name = getattr(region, "source", "unknown")
            confidence = getattr(region, "score", 0.0)
            if detector_name not in detector_results or confidence > detector_results[detector_name]:
                detector_results[detector_name] = confidence

        return PHIDetectionResult(
            phi_detected=result.has_phi,
            regions_count=result.region_count,
            regions=regions,
            detector_results=detector_results,
        )

    except ImportError:
        logger.debug("phi-detector-remover not installed, skipping PHI detection")
        return PHIDetectionResult(phi_detected=False, regions_count=0)
    except Exception as e:
        logger.warning(f"PHI detection failed: {e}")
        return PHIDetectionResult(phi_detected=False, regions_count=0)


def redact_phi(
    image_bytes: bytes,
    regions: list[Any],
    redaction_method: str = "redbox",
) -> PHIRedactionResult:
    """Redact detected PHI regions from an image."""
    if not regions:
        return PHIRedactionResult(image_bytes=image_bytes, regions_redacted=0, redaction_method=redaction_method)

    try:
        from phi_detector_remover import PHIRemover
        from phi_detector_remover.core.detector import PHIRegion

        phi_regions: list[PHIRegion] = []
        for region in regions:
            if isinstance(region, PHIRegion):
                phi_regions.append(region)
            elif isinstance(region, dict):
                bbox = region.get("bbox", {})
                if isinstance(bbox, dict):
                    bbox_tuple = (bbox.get("x", 0), bbox.get("y", 0), bbox.get("width", 0), bbox.get("height", 0))
                elif isinstance(bbox, (list, tuple)) and len(bbox) == 4:
                    bbox_tuple = tuple(bbox)
                else:
                    continue
                phi_regions.append(
                    PHIRegion(
                        entity_type=region.get("type", "UNKNOWN"),
                        text=region.get("text", ""),
                        score=region.get("confidence", 0.0),
                        bbox=bbox_tuple,
                        source=region.get("source", "llm"),
                    )
                )

        if not phi_regions:
            return PHIRedactionResult(image_bytes=image_bytes, regions_redacted=0, redaction_method=redaction_method)

        remover = PHIRemover(method=redaction_method)
        redacted_bytes = remover.remove(image_bytes, phi_regions)
        return PHIRedactionResult(
            image_bytes=redacted_bytes,
            regions_redacted=len(phi_regions),
            redaction_method=redaction_method,
        )

    except ImportError:
        logger.debug("phi-detector-remover not installed, skipping PHI redaction")
        return PHIRedactionResult(image_bytes=image_bytes, regions_redacted=0, redaction_method=redaction_method)
    except Exception as e:
        logger.warning(f"PHI redaction failed: {e}")
        return PHIRedactionResult(image_bytes=image_bytes, regions_redacted=0, redaction_method=redaction_method)


# =============================================================================
# Full pipeline functions
# =============================================================================


def preprocess_screenshot_file(
    file_path: str,
    phi_detection_enabled: bool = True,
    phi_pipeline_preset: str = "hipaa_compliant",
    phi_redaction_method: str = "redbox",
) -> PreprocessingResult:
    """Run full preprocessing pipeline on a screenshot file. No DB operations.

    Order: device detect -> crop (if iPad) -> PHI detect -> PHI redact

    Args:
        file_path: Path to raw screenshot
        phi_detection_enabled: Whether to run PHI detection/redaction
        phi_pipeline_preset: PHI pipeline preset (fast/balanced/hipaa_compliant/thorough)
        phi_redaction_method: PHI redaction method (redbox/blackbox/pixelate)

    Returns:
        PreprocessingResult with processed image and metadata
    """
    image_path = Path(file_path)

    if not image_path.exists():
        return PreprocessingResult(
            success=False,
            image_bytes=None,
            device_detection=None,
            was_cropped=False,
            was_patched=False,
            phi_detected=False,
            phi_regions_count=0,
            phi_redacted=False,
            skip_reason=f"File not found: {image_path}",
        )

    # 1. Device detection
    device = detect_device(image_path)

    # 2. Read image bytes
    try:
        image_bytes = image_path.read_bytes()
    except Exception as e:
        return PreprocessingResult(
            success=False,
            image_bytes=None,
            device_detection=device,
            was_cropped=False,
            was_patched=False,
            phi_detected=False,
            phi_regions_count=0,
            phi_redacted=False,
            skip_reason=f"Failed to read image: {e}",
        )

    # 3. Crop if iPad
    cropped_bytes, was_cropped, was_patched = crop_screenshot_if_ipad(image_bytes, device)

    # 4. PHI detection and redaction
    phi_detected = False
    phi_count = 0
    phi_redacted = False
    final_bytes = cropped_bytes

    if phi_detection_enabled:
        detection_result = detect_phi(cropped_bytes, preset=phi_pipeline_preset)
        phi_detected = detection_result.phi_detected
        phi_count = detection_result.regions_count

        if detection_result.phi_detected:
            redaction_result = redact_phi(cropped_bytes, detection_result.regions, redaction_method=phi_redaction_method)
            final_bytes = redaction_result.image_bytes
            phi_redacted = redaction_result.regions_redacted > 0

    return PreprocessingResult(
        success=True,
        image_bytes=final_bytes,
        device_detection=device,
        was_cropped=was_cropped,
        was_patched=was_patched,
        phi_detected=phi_detected,
        phi_regions_count=phi_count,
        phi_redacted=phi_redacted,
        skip_reason=None,
    )


def preprocess_screenshot_sync(
    db: Session,
    screenshot: Any,
    settings: Any | None = None,
    *,
    phi_pipeline_preset: str | None = None,
    phi_redaction_method: str | None = None,
    phi_detection_enabled: bool | None = None,
) -> dict:
    """Run preprocessing on a screenshot and update DB metadata.

    This is the Celery-compatible sync function. It:
    1. Runs the full preprocessing pipeline
    2. Saves the preprocessed image alongside the original
    3. Updates processing_metadata JSON with preprocessing results
    4. Returns a result dict

    Args:
        db: SQLAlchemy sync session
        screenshot: Screenshot model instance
        settings: Optional Settings instance (uses get_settings() if None)
        phi_pipeline_preset: Override PHI pipeline preset (takes precedence over settings)
        phi_redaction_method: Override PHI redaction method (takes precedence over settings)
        phi_detection_enabled: Override PHI detection toggle (takes precedence over settings)

    Returns:
        dict with preprocessing results and metadata
    """
    from sqlalchemy.orm.attributes import flag_modified

    from ..config import get_settings

    if settings is None:
        settings = get_settings()

    # Resolve effective values: explicit overrides > settings defaults
    effective_phi_detection = phi_detection_enabled if phi_detection_enabled is not None else getattr(settings, "PHI_DETECTION_ENABLED", True)
    effective_phi_preset = phi_pipeline_preset or getattr(settings, "PHI_PIPELINE_PRESET", "hipaa_compliant")
    effective_phi_method = phi_redaction_method or getattr(settings, "PHI_REDACTION_METHOD", "redbox")

    # Always preprocess from the original file, not a previously preprocessed version
    existing_preprocessing = (screenshot.processing_metadata or {}).get("preprocessing", {})
    file_path = existing_preprocessing.get("original_file_path", screenshot.file_path)
    logger.info(f"Preprocessing screenshot {screenshot.id}: {file_path}")

    # Run preprocessing pipeline
    result = preprocess_screenshot_file(
        file_path=file_path,
        phi_detection_enabled=effective_phi_detection,
        phi_pipeline_preset=effective_phi_preset,
        phi_redaction_method=effective_phi_method,
    )

    # Build metadata dict
    preprocessing_metadata: dict[str, Any] = {
        "preprocessing_timestamp": datetime.now(timezone.utc).isoformat(),
        "original_file_path": file_path,
    }

    if result.device_detection:
        preprocessing_metadata["device_detection"] = {
            "device_category": result.device_detection.device_category,
            "device_model": result.device_detection.device_model,
            "confidence": result.device_detection.confidence,
            "is_ipad": result.device_detection.is_ipad,
            "is_iphone": result.device_detection.is_iphone,
            "orientation": result.device_detection.orientation,
        }

        # Update device_type on the screenshot model if detected
        if result.device_detection.detected:
            if result.device_detection.is_ipad:
                screenshot.device_type = "ipad"
            elif result.device_detection.is_iphone:
                screenshot.device_type = "iphone"

    preprocessing_metadata["cropping"] = {
        "was_cropped": result.was_cropped,
        "was_patched": result.was_patched,
    }

    if result.was_cropped and result.device_detection:
        preprocessing_metadata["cropping"]["original_dimensions"] = [
            result.device_detection.width,
            result.device_detection.height,
        ]

    preprocessing_metadata["phi_detection"] = {
        "phi_detected": result.phi_detected,
        "regions_count": result.phi_regions_count,
        "preset": effective_phi_preset,
    }

    preprocessing_metadata["phi_redaction"] = {
        "redacted": result.phi_redacted,
        "regions_redacted": result.phi_regions_count if result.phi_redacted else 0,
        "method": effective_phi_method,
    }

    # Save preprocessed image if pipeline produced output
    preprocessed_file_path = None
    if result.success and result.image_bytes:
        original_path = Path(file_path)
        preprocessed_path = original_path.parent / f"{original_path.stem}_preprocessed{original_path.suffix}"
        try:
            preprocessed_path.write_bytes(result.image_bytes)
            preprocessed_file_path = str(preprocessed_path)
            preprocessing_metadata["preprocessed_file_path"] = preprocessed_file_path
            logger.info(f"Screenshot {screenshot.id}: saved preprocessed image to {preprocessed_path}")
        except Exception as e:
            logger.error(f"Screenshot {screenshot.id}: failed to save preprocessed image: {e}")

    if not result.success:
        preprocessing_metadata["skip_reason"] = result.skip_reason

    # Merge preprocessing metadata into existing processing_metadata
    existing_metadata = screenshot.processing_metadata or {}
    existing_metadata["preprocessing"] = preprocessing_metadata
    screenshot.processing_metadata = existing_metadata
    flag_modified(screenshot, "processing_metadata")

    db.commit()
    db.refresh(screenshot)

    logger.info(
        f"Screenshot {screenshot.id}: preprocessing complete "
        f"(cropped={result.was_cropped}, phi_detected={result.phi_detected}, "
        f"phi_redacted={result.phi_redacted})"
    )

    return {
        "success": result.success,
        "screenshot_id": screenshot.id,
        "preprocessed_file_path": preprocessed_file_path,
        "was_cropped": result.was_cropped,
        "phi_detected": result.phi_detected,
        "phi_redacted": result.phi_redacted,
        "skip_reason": result.skip_reason,
    }
