"""
Test core programmatic usage (no GUI dependencies).
"""

from __future__ import annotations

from pathlib import Path


class TestCoreUsage:
    """Test core module can be used programmatically."""

    def test_core_imports(self):
        """Test that core can be imported without GUI dependencies."""
        from screenshot_processor.core import (
            ImageType,
            OutputConfig,
            ProcessorConfig,
            ScreenshotProcessor,
        )

        assert ImageType is not None
        assert OutputConfig is not None
        assert ProcessorConfig is not None
        assert ScreenshotProcessor is not None

    def test_processor_config_creation(self):
        """Test that ProcessorConfig can be created."""
        from screenshot_processor.core import (
            ImageType,
            OutputConfig,
            ProcessorConfig,
        )

        config = ProcessorConfig(
            image_type=ImageType.BATTERY,
            output=OutputConfig(output_dir=Path("./output")),
        )

        assert config.image_type == ImageType.BATTERY
        assert config.output.output_dir == Path("./output")

    def test_processor_instantiation(self):
        """Test that ScreenshotProcessor can be instantiated."""
        from screenshot_processor.core import (
            ImageType,
            OutputConfig,
            ProcessorConfig,
            ScreenshotProcessor,
        )

        config = ProcessorConfig(
            image_type=ImageType.BATTERY,
            output=OutputConfig(output_dir=Path("./output")),
        )

        processor = ScreenshotProcessor(config=config)
        assert processor is not None

    def test_image_type_enum(self):
        """Test ImageType enum values."""
        from screenshot_processor.core import ImageType

        assert ImageType.BATTERY.value == "battery"
        assert ImageType.SCREEN_TIME.value == "screen_time"
