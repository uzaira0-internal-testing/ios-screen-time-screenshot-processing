"""Rust acceleration layer — try Rust (PyO3) first, fall back to Python.

This module provides accelerated versions of core processing functions.
If screenshot_processor_rs is installed, functions run in Rust (~30x faster).
Otherwise, they transparently fall back to the pure-Python implementations.

Usage:
    from screenshot_processor.core.rust_accelerator import slice_image, detect_grid

    # These automatically use Rust if available, Python if not.
    row = slice_image(img, roi_x, roi_y, roi_width, roi_height)
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_RUST_AVAILABLE: bool | None = None
_rs = None


def _check_rust():
    global _RUST_AVAILABLE, _rs
    if _RUST_AVAILABLE is None:
        try:
            import screenshot_processor_rs

            _rs = screenshot_processor_rs
            _RUST_AVAILABLE = True
            logger.info("Rust acceleration enabled (screenshot_processor_rs)")
        except ImportError:
            _RUST_AVAILABLE = False
            logger.debug("screenshot_processor_rs not installed, using Python fallback")
    return _RUST_AVAILABLE


def normalize_ocr_digits(text: str) -> str:
    """Normalize OCR digit confusions. Rust if available, else Python."""
    if _check_rust():
        return _rs.normalize_ocr_digits(text)
    from .ocr import _normalize_ocr_digits

    return _normalize_ocr_digits(text)


def extract_time_from_text(text: str) -> str:
    """Extract time from OCR text. Rust if available, else Python."""
    if _check_rust():
        return _rs.extract_time_from_text(text)
    from .ocr import _extract_time_from_text

    return _extract_time_from_text(text)


def detect_grid(image_path: str, method: str = "line_based") -> dict | None:
    """Detect grid bounds. Rust if available, else Python."""
    if _check_rust():
        return _rs.detect_grid(image_path, method)

    from .image_processor import load_and_validate_image
    from .line_based_detection import LineBasedDetector

    img = load_and_validate_image(image_path)
    h, w = img.shape[:2]
    detector = LineBasedDetector.default()
    result = detector.detect(img, resolution=f"{w}x{h}")
    if result.success and result.bounds:
        b = result.bounds
        return {
            "upper_left_x": b.x,
            "upper_left_y": b.y,
            "lower_right_x": b.x + b.width,
            "lower_right_y": b.y + b.height,
        }
    return None


def process_image(
    image_path: str,
    image_type: str = "screen_time",
    detection_method: str = "line_based",
) -> dict:
    """Full pipeline processing. Rust if available, else Python."""
    if _check_rust():
        return _rs.process_image(image_path, image_type, detection_method)

    # Python fallback
    from .image_processor import process_image as py_process_image

    result = py_process_image(image_path, is_battery=(image_type == "battery"))
    if result is None:
        raise RuntimeError("Python process_image returned None")

    filename, graph_filename, row, title, total, total_image_path, grid_coords = result
    return {
        "hourly_values": list(row[:24]) if row else [0.0] * 24,
        "total": sum(row[:24]) if row else 0.0,
        "title": title,
        "total_text": total,
        "grid_bounds": grid_coords,
        "alignment_score": 0.0,
        "detection_method": detection_method,
        "processing_time_ms": 0,
    }
