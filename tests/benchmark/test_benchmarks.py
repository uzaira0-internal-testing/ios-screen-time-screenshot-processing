"""
Benchmark tests for performance-critical functions.

Uses pytest-benchmark to measure execution time of core processing functions.
Run with: pytest tests/benchmark/ --benchmark-only
"""
import pytest
import numpy as np

try:
    from screenshot_processor.core.bar_extraction import compute_bar_alignment_score, slice_image
    from screenshot_processor.core.image_utils import (
        adjust_contrast_brightness,
        convert_dark_mode,
        darken_non_white,
        reduce_color_count,
        scale_up,
    )

    HAS_CORE = True
except ImportError:
    HAS_CORE = False

try:
    import pytest_benchmark  # noqa: F401

    HAS_BENCHMARK = True
except ImportError:
    HAS_BENCHMARK = False

pytestmark = [
    pytest.mark.skipif(not HAS_CORE, reason="Core modules not importable"),
    pytest.mark.skipif(not HAS_BENCHMARK, reason="pytest-benchmark not installed"),
    pytest.mark.benchmark,
]


@pytest.fixture
def sample_image():
    """Create a realistic-sized test image (iPhone screenshot dimensions)."""
    return np.random.randint(0, 255, (2532, 1170, 3), dtype=np.uint8)


@pytest.fixture
def small_image():
    """Small image for fast benchmarks."""
    return np.random.randint(0, 255, (500, 300, 3), dtype=np.uint8)


@pytest.fixture
def roi_image():
    """Image sized like a typical bar graph ROI."""
    return np.random.randint(0, 255, (200, 600, 3), dtype=np.uint8)


class TestBarExtractionBenchmarks:
    """Benchmark bar extraction performance."""

    def test_slice_image_speed(self, benchmark, roi_image):
        """slice_image should process a ROI in <50ms."""
        result = benchmark(slice_image, roi_image)
        assert len(result) == 25

    def test_alignment_score_speed(self, benchmark):
        """compute_bar_alignment_score should be <1ms."""
        bars = [float(i) for i in range(24)]
        roi = np.random.randint(0, 255, (200, 600, 3), dtype=np.uint8)
        benchmark(compute_bar_alignment_score, bars, roi)


class TestImageUtilsBenchmarks:
    """Benchmark image utility functions."""

    def test_dark_mode_conversion_speed(self, benchmark, small_image):
        """Dark mode conversion should be <100ms for a small image."""
        benchmark(convert_dark_mode, small_image)

    def test_contrast_adjustment_speed(self, benchmark, small_image):
        """Contrast/brightness adjustment should be fast."""
        benchmark(adjust_contrast_brightness, small_image)

    def test_scale_up_speed(self, benchmark, small_image):
        """4x scale-up speed."""
        benchmark(scale_up, small_image, 4)

    def test_darken_non_white_speed(self, benchmark, small_image):
        """darken_non_white performance."""
        benchmark(darken_non_white, small_image)

    def test_reduce_color_count_speed(self, benchmark, small_image):
        """Color reduction performance."""
        benchmark(reduce_color_count, small_image, 4)
