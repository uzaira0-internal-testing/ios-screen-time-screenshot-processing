"""PHI detection and redaction for preprocessing pipeline."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


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


def detect_phi(
    image_bytes: bytes,
    preset: str = "screen_time",
    llm_endpoint: str | None = None,
    llm_model: str | None = None,
    llm_api_key: str | None = None,
    ocr_engine: str = "pytesseract",
    ner_detector: str = "presidio",
) -> PHIDetectionResult:
    """Detect PHI regions in an image.

    Args:
        image_bytes: Image data
        preset: Pipeline preset (fast/balanced/hipaa_compliant/thorough/screen_time)
    """
    try:
        from phi_detector_remover import PHIPipelineBuilder

        builders = {
            "fast": PHIPipelineBuilder.fast,
            "balanced": PHIPipelineBuilder.balanced,
            "hipaa_compliant": PHIPipelineBuilder.hipaa_compliant,
            "thorough": PHIPipelineBuilder.thorough,
            "screen_time": PHIPipelineBuilder.screen_time,
        }

        if preset == "screen_time":
            # Custom pipeline for screen time screenshots.
            # OCR engine and NER detector are user-configurable.
            builder = PHIPipelineBuilder().with_ocr(ocr_engine)

            # Add the chosen NER detector
            if ner_detector == "gliner":
                builder = builder.add_gliner(threshold=0.3)
            else:
                builder = builder.add_presidio(score_threshold=0.4)

            builder = (
                builder
                .with_prompt("screen_time")
                .union_aggregation()
                .with_min_bbox_area(100)
                .with_merge_nearby(enabled=False)
                .with_allow_list(
                    [
                        # Common OCR artifacts from bar charts that Presidio misreads
                        "INFO",
                        "INFO Paget",
                        "Camera Lo",
                        "My Tom",
                        "My Talking Tom",
                        "al l",
                        "al l - Daily",
                        "YtKids",
                        "Yt Kids",
                    ]
                )
            )
        else:
            builder_fn = builders.get(preset, PHIPipelineBuilder.screen_time)
            builder = builder_fn()
            # Override OCR engine if non-default
            if ocr_engine != "pytesseract":
                # Non-default presets use "tesseract" internally; override if user chose leptess
                builder = builder.with_ocr(ocr_engine)

        if llm_endpoint and llm_model:
            builder = builder.add_llm(model=llm_model, api_endpoint=llm_endpoint, api_key=llm_api_key)

        pipeline = builder.build()
        result = pipeline.process(image_bytes)

        # PipelineResult API: .has_phi, .region_count, .aggregated_regions, .get_regions_for_redaction()
        regions = result.get_regions_for_redaction()

        detector_results: dict[str, float] = {}
        for region in regions:
            detector_name = getattr(region, "source", "unknown")
            confidence = getattr(region, "confidence", getattr(region, "score", 0.0))
            if detector_name not in detector_results or confidence > detector_results[detector_name]:
                detector_results[detector_name] = confidence

        return PHIDetectionResult(
            phi_detected=len(regions) > 0,
            regions_count=len(regions),
            regions=regions,
            detector_results=detector_results,
        )

    except ImportError:
        logger.debug("phi-detector-remover not installed, skipping PHI detection")
        return PHIDetectionResult(phi_detected=False, regions_count=0)
    except Exception:
        logger.error("PHI detection failed", exc_info=True)
        raise


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
                bbox = region.get("bbox")
                if isinstance(bbox, dict):
                    # Nested bbox format: {x, y, width, height}
                    bbox_tuple = (bbox.get("x", 0), bbox.get("y", 0), bbox.get("width", 0), bbox.get("height", 0))
                elif isinstance(bbox, (list, tuple)) and len(bbox) == 4:
                    bbox_tuple = tuple(bbox)
                elif "x" in region and "y" in region:
                    # Flat serialized format from serialize_phi_regions: {x, y, w, h}
                    bbox_tuple = (region["x"], region["y"], region.get("w", 0), region.get("h", 0))
                else:
                    continue
                phi_regions.append(
                    PHIRegion(
                        entity_type=region.get("label", region.get("type", "UNKNOWN")),
                        text=region.get("text", ""),
                        score=region.get("confidence", 0.0),
                        bbox=bbox_tuple,
                        source=region.get("source", "auto"),
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
    except Exception:
        logger.error("PHI redaction failed", exc_info=True)
        raise


def serialize_phi_regions(regions: list) -> list[dict]:
    """Convert PHI regions (which may be PHIRegion objects) to serializable dicts."""
    serialized = []
    for region in regions:
        if isinstance(region, dict):
            serialized.append(region)
        else:
            # PHIRegion object — bbox may be a tuple OR a BoundingBox dataclass
            bbox = getattr(region, "bbox", None)
            if bbox is None:
                x, y, w, h = 0, 0, 0, 0
            elif hasattr(bbox, "x"):
                # BoundingBox dataclass with .x, .y, .width, .height
                x, y, w, h = bbox.x, bbox.y, bbox.width, bbox.height
            else:
                # Plain tuple (x, y, w, h)
                x, y, w, h = bbox[0], bbox[1], bbox[2], bbox[3]
            serialized.append(
                {
                    "x": x,
                    "y": y,
                    "w": w,
                    "h": h,
                    "label": getattr(region, "entity_type", "UNKNOWN"),
                    "source": getattr(region, "source", "auto"),
                    "confidence": getattr(region, "confidence", getattr(region, "score", 0.0)),
                    "text": getattr(region, "text", ""),
                }
            )
    return serialized
