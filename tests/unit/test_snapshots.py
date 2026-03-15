"""Snapshot tests for API schemas, OCR output patterns, config shapes, and error responses.

These tests verify that serialized schema shapes and processing outputs remain
stable over time. They use inline expected dictionaries rather than external
snapshot files, making regressions immediately visible in diffs.
"""

from __future__ import annotations

import datetime
import json

import pytest

# ---------------------------------------------------------------------------
# Guard imports so the suite degrades gracefully when optional deps are missing
# ---------------------------------------------------------------------------
try:
    from pydantic import ValidationError

    from screenshot_processor.web.database.schemas import (
        AnnotationCreate,
        AnnotationRead,
        GroupRead,
        Point,
        ProcessingIssue,
        ProcessingResultResponse,
        ScreenshotRead,
        StatsResponse,
    )

    HAS_SCHEMAS = True
except ImportError:
    HAS_SCHEMAS = False

try:
    from screenshot_processor.core.ocr import (
        _extract_time_from_text,
        _normalize_ocr_digits,
        is_daily_total_page,
    )

    HAS_OCR = True
except ImportError:
    HAS_OCR = False

try:
    from screenshot_processor.core.config import (
        ImageProcessingConfig,
        OCRConfig,
    )

    HAS_CONFIG = True
except ImportError:
    HAS_CONFIG = False

# ============================================================================
# 1. API Schema Serialization Snapshots
# ============================================================================

_NOW = datetime.datetime(2025, 6, 15, 12, 0, 0, tzinfo=datetime.timezone.utc)


@pytest.mark.skipif(not HAS_SCHEMAS, reason="Schema imports unavailable")
class TestScreenshotReadSnapshot:
    """ScreenshotRead serialization must match a known shape."""

    def _make_screenshot(self, **overrides) -> ScreenshotRead:
        defaults = dict(
            id=42,
            file_path="uploads/group1/img_001.png",
            image_type="screen_time",
            annotation_status="pending",
            target_annotations=2,
            current_annotation_count=0,
            has_consensus=None,
            uploaded_at=_NOW,
            processing_status="pending",
            uploaded_by_id=1,
        )
        defaults.update(overrides)
        return ScreenshotRead(**defaults)

    def test_minimal_screenshot_read_shape(self):
        """A minimal ScreenshotRead must contain all required keys."""
        obj = self._make_screenshot()
        data = json.loads(obj.model_dump_json())

        expected_keys = {
            "id",
            "file_path",
            "image_type",
            "annotation_status",
            "target_annotations",
            "current_annotation_count",
            "has_consensus",
            "uploaded_at",
            "processing_status",
            "extracted_title",
            "extracted_total",
            "extracted_hourly_data",
            "processing_time_seconds",
            "alignment_score",
            "alignment_score_status",
            "processing_method",
            "grid_detection_confidence",
            "processing_issues",
            "has_blocking_issues",
            "title_y_position",
            "grid_upper_left_x",
            "grid_upper_left_y",
            "grid_lower_right_x",
            "grid_lower_right_y",
            "participant_id",
            "group_id",
            "source_id",
            "device_type",
            "original_filepath",
            "screenshot_date",
            "verified_by_user_ids",
            "verified_by_usernames",
            "resolved_hourly_data",
            "resolved_title",
            "resolved_total",
            "resolved_at",
            "resolved_by_user_id",
            "potential_duplicate_of",
            "processing_metadata",
            "content_hash",
            "processed_at",
            "uploaded_by_id",
        }
        assert expected_keys.issubset(set(data.keys())), (
            f"Missing keys: {expected_keys - set(data.keys())}"
        )

    def test_screenshot_read_default_values(self):
        """Default nullable fields must serialize to None / expected defaults."""
        obj = self._make_screenshot()
        data = obj.model_dump()

        assert data["extracted_title"] is None
        assert data["extracted_total"] is None
        assert data["extracted_hourly_data"] is None
        assert data["has_blocking_issues"] is False
        assert data["alignment_score"] is None
        assert data["processing_method"] is None

    def test_screenshot_read_with_grid_coords(self):
        """Grid coordinate fields serialize as flat integers."""
        obj = self._make_screenshot(
            grid_upper_left_x=100,
            grid_upper_left_y=200,
            grid_lower_right_x=500,
            grid_lower_right_y=400,
        )
        data = obj.model_dump()

        assert data["grid_upper_left_x"] == 100
        assert data["grid_upper_left_y"] == 200
        assert data["grid_lower_right_x"] == 500
        assert data["grid_lower_right_y"] == 400

    def test_alignment_score_status_computed_field(self):
        """alignment_score_status computed field returns expected structure."""
        good = self._make_screenshot(alignment_score=0.92)
        assert good.alignment_score_status == {
            "status": "good",
            "description": "Excellent alignment - grid boundaries match well with the bar graph.",
            "action": None,
        }

        warning = self._make_screenshot(alignment_score=0.55)
        assert warning.alignment_score_status["status"] == "warning"

        poor = self._make_screenshot(alignment_score=0.3)
        assert poor.alignment_score_status["status"] == "poor"

        none_score = self._make_screenshot(alignment_score=None)
        assert none_score.alignment_score_status is None


@pytest.mark.skipif(not HAS_SCHEMAS, reason="Schema imports unavailable")
class TestAnnotationSchemaSnapshots:
    """Annotation schema serialization snapshots."""

    def test_annotation_create_shape(self):
        """AnnotationCreate accepts nested Point objects and hourly values."""
        obj = AnnotationCreate(
            screenshot_id=1,
            hourly_values={"0": 10, "1": 20, "23": 5},
            extracted_title="Safari",
            extracted_total="2h 30m",
            grid_upper_left=Point(x=100, y=200),
            grid_lower_right=Point(x=500, y=400),
        )
        data = obj.model_dump()

        assert data["screenshot_id"] == 1
        assert data["hourly_values"] == {"0": 10, "1": 20, "23": 5}
        assert data["grid_upper_left"] == {"x": 100, "y": 200}
        assert data["grid_lower_right"] == {"x": 500, "y": 400}
        assert data["extracted_title"] == "Safari"
        assert data["extracted_total"] == "2h 30m"

    def test_annotation_read_shape(self):
        """AnnotationRead includes DB metadata fields."""
        obj = AnnotationRead(
            id=7,
            screenshot_id=1,
            user_id=3,
            status="pending",
            hourly_values={str(i): 0 for i in range(24)},
            created_at=_NOW,
            updated_at=_NOW,
        )
        data = obj.model_dump()

        expected_keys = {
            "id", "screenshot_id", "user_id", "status",
            "hourly_values", "extracted_title", "extracted_total",
            "grid_upper_left", "grid_lower_right",
            "time_spent_seconds", "notes",
            "created_at", "updated_at",
        }
        assert expected_keys.issubset(set(data.keys()))
        assert data["status"] == "pending"
        assert len(data["hourly_values"]) == 24


@pytest.mark.skipif(not HAS_SCHEMAS, reason="Schema imports unavailable")
class TestGroupReadSnapshot:
    """GroupRead serialization snapshot."""

    def test_group_read_shape(self):
        obj = GroupRead(
            id="study-2025",
            name="Study Group 2025",
            image_type="screen_time",
            created_at=_NOW,
            screenshot_count=50,
            processing_pending=10,
            processing_completed=35,
            processing_failed=3,
            processing_skipped=2,
        )
        data = obj.model_dump()

        expected = {
            "id": "study-2025",
            "name": "Study Group 2025",
            "image_type": "screen_time",
            "screenshot_count": 50,
            "processing_pending": 10,
            "processing_completed": 35,
            "processing_failed": 3,
            "processing_skipped": 2,
            "processing_deleted": 0,
            "total_processing_time_seconds": None,
            "avg_processing_time_seconds": None,
            "min_processing_time_seconds": None,
            "max_processing_time_seconds": None,
        }
        for key, val in expected.items():
            assert data[key] == val, f"Mismatch on {key}: {data[key]} != {val}"


@pytest.mark.skipif(not HAS_SCHEMAS, reason="Schema imports unavailable")
class TestStatsResponseSnapshot:
    """StatsResponse serialization snapshot."""

    def test_stats_response_shape(self):
        obj = StatsResponse(
            total_screenshots=100,
            pending_screenshots=20,
            completed_screenshots=75,
            total_annotations=200,
            screenshots_with_consensus=60,
            screenshots_with_disagreements=5,
            average_annotations_per_screenshot=2.0,
            users_active=8,
            auto_processed=50,
            pending=20,
            failed=3,
            skipped=2,
            deleted=0,
        )
        data = obj.model_dump()

        expected = {
            "total_screenshots": 100,
            "pending_screenshots": 20,
            "completed_screenshots": 75,
            "total_annotations": 200,
            "screenshots_with_consensus": 60,
            "screenshots_with_disagreements": 5,
            "average_annotations_per_screenshot": 2.0,
            "users_active": 8,
            "auto_processed": 50,
            "pending": 20,
            "failed": 3,
            "skipped": 2,
            "deleted": 0,
        }
        assert data == expected


# ============================================================================
# 2. OCR Output Snapshots
# ============================================================================


@pytest.mark.skipif(not HAS_OCR, reason="OCR imports unavailable")
class TestTimeExtractionSnapshots:
    """Time string extraction must produce known outputs for known inputs."""

    @pytest.mark.parametrize(
        "input_text, expected",
        [
            ("4h 36m", "4h 36m"),
            ("4h36m", "4h 36m"),
            ("4h  36m", "4h 36m"),
            ("2h 30m remaining", "2h 30m"),
            ("12m 30s", "12m 30s"),
            ("45m", "45m"),
            ("3h", "3h"),
            ("15s", "15s"),
            ("no time here", ""),
            ("4h 36", "4h 36m"),  # Missing 'm' fallback
        ],
    )
    def test_extract_time_patterns(self, input_text: str, expected: str):
        result = _extract_time_from_text(input_text)
        assert result == expected, f"Input '{input_text}' -> '{result}', expected '{expected}'"

    @pytest.mark.parametrize(
        "input_text, expected",
        [
            ("Im", "1m"),         # I -> 1
            ("Oh", "0h"),         # O -> 0
            ("Am", "4m"),         # A -> 4
            ("Sh", "5h"),         # S -> 5
            ("1O2m", "102m"),     # O between digits -> 0
        ],
    )
    def test_normalize_ocr_digits(self, input_text: str, expected: str):
        result = _normalize_ocr_digits(input_text)
        assert result == expected, f"Input '{input_text}' -> '{result}', expected '{expected}'"

    def test_combined_normalize_and_extract(self):
        """Normalization + extraction pipeline produces correct total."""
        # "Ih 3Om" should normalize to "1h 30m" and extract as "1h 30m"
        normalized = _normalize_ocr_digits("1h 3Om")
        result = _extract_time_from_text(normalized)
        assert result == "1h 30m"


@pytest.mark.skipif(not HAS_OCR, reason="OCR imports unavailable")
class TestDailyPageDetectionSnapshot:
    """is_daily_total_page should correctly classify OCR dicts."""

    def _make_ocr_dict(self, words: list[str]) -> dict:
        return {
            "text": words,
            "level": [5] * len(words),
            "left": [0] * len(words),
            "top": [0] * len(words),
            "width": [10] * len(words),
            "height": [10] * len(words),
        }

    def test_daily_page_detected(self):
        """Words like WEEK, DAY, MOST, CATEGORIES mark a daily total page."""
        ocr_dict = self._make_ocr_dict([
            "WEEK", "DAY", "MOST", "USED", "CATEGORIES", "SHOW",
        ])
        assert is_daily_total_page(ocr_dict) is True

    def test_app_page_detected(self):
        """Words like INFO, DEVELOPER, LIMIT mark an app-specific page."""
        ocr_dict = self._make_ocr_dict([
            "INFO", "DEVELOPER", "RATING", "LIMIT", "AGE", "DAILY", "AVERAGE",
        ])
        assert is_daily_total_page(ocr_dict) is False


# ============================================================================
# 3. Config / Mode Detection Snapshots
# ============================================================================


@pytest.mark.skipif(not HAS_CONFIG, reason="Config imports unavailable")
class TestConfigShapeSnapshots:
    """Config dataclass shapes must remain stable."""

    def test_ocr_config_server_mode_shape(self):
        """Server mode: hybrid OCR with all engines enabled."""
        config = OCRConfig(
            engine_type="hybrid",
            use_hybrid=True,
            hybrid_enable_hunyuan=True,
            hybrid_enable_paddleocr=True,
            hybrid_enable_tesseract=True,
        )
        expected = {
            "engine_type": "hybrid",
            "use_hybrid": True,
            "hybrid_enable_hunyuan": True,
            "hybrid_enable_paddleocr": True,
            "hybrid_enable_tesseract": True,
            "psm_mode_default": "3",
            "psm_mode_data": "12",
            "hybrid_paddleocr_for_grid": False,
            "auto_select": True,
            "prefer_hunyuan": True,
        }
        for key, val in expected.items():
            assert getattr(config, key) == val, f"{key}: {getattr(config, key)} != {val}"

    def test_ocr_config_wasm_mode_shape(self):
        """WASM mode: tesseract-only, no hybrid."""
        config = OCRConfig(
            engine_type="tesseract",
            use_hybrid=False,
            hybrid_enable_hunyuan=False,
            hybrid_enable_paddleocr=False,
            hybrid_enable_tesseract=True,
        )
        assert config.engine_type == "tesseract"
        assert config.use_hybrid is False
        assert config.hybrid_enable_hunyuan is False
        assert config.hybrid_enable_paddleocr is False
        assert config.hybrid_enable_tesseract is True

    def test_image_processing_config_defaults(self):
        """ImageProcessingConfig defaults must stay stable."""
        config = ImageProcessingConfig()
        assert config.contrast == 2.0
        assert config.brightness == -220
        assert config.debug_enabled is False
        assert config.save_debug_images is True


# ============================================================================
# 4. Error Response Snapshots
# ============================================================================


@pytest.mark.skipif(not HAS_SCHEMAS, reason="Schema imports unavailable")
class TestErrorResponseSnapshots:
    """Error response shapes from Pydantic validation."""

    def test_validation_error_shape(self):
        """Pydantic validation errors produce a stable structure."""
        with pytest.raises(ValidationError) as exc_info:
            AnnotationCreate(
                screenshot_id=1,
                hourly_values={"invalid_key": 10},  # not 0-23
            )

        errors = exc_info.value.errors()
        assert len(errors) >= 1

        first_error = errors[0]
        # Pydantic v2 error structure
        assert "type" in first_error
        assert "msg" in first_error
        assert "loc" in first_error

    def test_validation_error_negative_minutes(self):
        """Negative minute values produce a specific validation error."""
        with pytest.raises(ValidationError) as exc_info:
            AnnotationCreate(
                screenshot_id=1,
                hourly_values={"0": -5},
            )

        errors = exc_info.value.errors()
        assert any("negative" in e["msg"].lower() for e in errors)

    def test_validation_error_grid_too_small(self):
        """Grid coordinates too close together produce a validation error."""
        with pytest.raises(ValidationError) as exc_info:
            AnnotationCreate(
                screenshot_id=1,
                hourly_values={"0": 0},
                grid_upper_left=Point(x=100, y=200),
                grid_lower_right=Point(x=105, y=205),  # Only 5px apart, minimum is 10
            )

        errors = exc_info.value.errors()
        assert any("too small" in e["msg"].lower() for e in errors)

    def test_processing_result_failure_shape(self):
        """Failed ProcessingResultResponse has expected shape."""
        result = ProcessingResultResponse(
            success=False,
            processing_status="failed",
            message="Grid detection failed",
            issues=[
                ProcessingIssue(
                    issue_type="grid_detection_failed",
                    severity="blocking",
                    description="Could not find 12AM anchor",
                ),
            ],
            has_blocking_issues=True,
        )
        data = result.model_dump()

        assert data["success"] is False
        assert data["processing_status"] == "failed"
        assert data["has_blocking_issues"] is True
        assert len(data["issues"]) == 1
        assert data["issues"][0]["issue_type"] == "grid_detection_failed"
        assert data["issues"][0]["severity"] == "blocking"
        assert data["extracted_hourly_data"] is None
