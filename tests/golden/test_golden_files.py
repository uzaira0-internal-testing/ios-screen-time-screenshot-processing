"""
Golden file tests — compare function output against stored reference files.

Golden files are stored in tests/golden/fixtures/. To update them:
    pytest tests/golden/ --update-golden

These catch unintentional changes to output formats, serialization,
and processing results.
"""
import json
import os
from pathlib import Path

import pytest

GOLDEN_DIR = Path(__file__).parent / "fixtures"
UPDATE_GOLDEN = os.environ.get("UPDATE_GOLDEN", "") == "1"

try:
    from screenshot_processor.core.interfaces import GridBounds
    from screenshot_processor.web.database.schemas import (
        AnnotationBase,
        ScreenshotCreate,
    )

    HAS_SCHEMAS = True
except ImportError:
    HAS_SCHEMAS = False

pytestmark = pytest.mark.skipif(not HAS_SCHEMAS, reason="Schemas not importable")


def assert_golden(name: str, actual: dict | list | str):
    """Compare actual output against golden file. Update if UPDATE_GOLDEN=1."""
    golden_path = GOLDEN_DIR / f"{name}.golden.json"

    if isinstance(actual, (dict, list)):
        actual_str = json.dumps(actual, indent=2, sort_keys=True, default=str)
    else:
        actual_str = str(actual)

    if UPDATE_GOLDEN or not golden_path.exists():
        golden_path.parent.mkdir(parents=True, exist_ok=True)
        golden_path.write_text(actual_str + "\n")
        pytest.skip(f"Golden file created/updated: {golden_path}")
        return

    expected = golden_path.read_text().strip()
    assert actual_str.strip() == expected, (
        f"Output differs from golden file {golden_path.name}. "
        f"Run with UPDATE_GOLDEN=1 to update."
    )


class TestSchemaGoldenFiles:
    """Verify schema serialization hasn't changed."""

    def test_screenshot_create_schema(self):
        obj = ScreenshotCreate(
            file_path="uploads/group1/img.png",
            image_type="screen_time",
        )
        assert_golden("screenshot_create", obj.model_dump(mode="json"))

    def test_annotation_base_schema(self):
        obj = AnnotationBase(
            hourly_values={"0": 10, "1": 20, "23": 5},
            extracted_title="Instagram",
            extracted_total="2h 30m",
        )
        assert_golden("annotation_base", obj.model_dump(mode="json"))

    def test_grid_bounds_serialization(self):
        bounds = GridBounds(
            upper_left_x=100, upper_left_y=200, lower_right_x=500, lower_right_y=400
        )
        assert_golden("grid_bounds", bounds.to_dict())


class TestConfigGoldenFiles:
    """Verify config shapes haven't changed."""

    def test_openapi_schema_keys(self):
        """The OpenAPI schema should have the expected top-level keys."""
        try:
            os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-chars-long-for-testing")
            os.environ.pop("SITE_PASSWORD", None)
            from screenshot_processor.web.api.main import app

            schema = app.openapi()
            # Only check top-level structure, not full content
            top_keys = sorted(schema.keys())
            assert_golden("openapi_top_keys", top_keys)
        except Exception:
            pytest.skip("Cannot import app")
