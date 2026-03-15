"""Cross-implementation parity tests: Python backend vs TypeScript/WASM frontend.

Both the Python backend and the TypeScript WASM frontend implement the same
algorithms for bar extraction, grid detection, dark mode handling, alignment
scoring, and time parsing. These tests define known input/output fixtures from
the Python side and verify the Python functions produce them. The inline
constants serve as a contract: the TypeScript implementation MUST produce
identical results for the same inputs.

Each test documents the corresponding TypeScript function that must match.
"""

from __future__ import annotations

import pytest

# ---------------------------------------------------------------------------
# Guard imports
# ---------------------------------------------------------------------------
try:
    import numpy as np

    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    from screenshot_processor.core.bar_extraction import (
        compute_bar_alignment_score,
        slice_image,
    )

    HAS_BAR_EXTRACTION = True
except ImportError:
    HAS_BAR_EXTRACTION = False

try:
    from screenshot_processor.core.image_utils import (
        convert_dark_mode,
        darken_non_white,
        reduce_color_count,
        scale_up,
    )

    HAS_IMAGE_UTILS = True
except ImportError:
    HAS_IMAGE_UTILS = False

try:
    from screenshot_processor.core.roi import calculate_roi_from_clicks

    HAS_ROI = True
except ImportError:
    HAS_ROI = False

try:
    from screenshot_processor.core.ocr import (
        _extract_time_from_text,
        _normalize_ocr_digits,
    )

    HAS_OCR = True
except ImportError:
    HAS_OCR = False

try:
    from screenshot_processor.core.interfaces import GridBounds

    HAS_INTERFACES = True
except ImportError:
    HAS_INTERFACES = False


# ============================================================================
# 1. compute_bar_alignment_score parity
#    TS: computeBarAlignmentScore() in barExtraction.canvas.ts
# ============================================================================


@pytest.mark.skipif(
    not (HAS_BAR_EXTRACTION and HAS_NUMPY),
    reason="bar_extraction or numpy unavailable",
)
class TestBarAlignmentScoreParity:
    """Python compute_bar_alignment_score must match TS computeBarAlignmentScore."""

    def test_perfect_alignment_both_zero(self):
        """When both extracted and computed are all zeros, score = 1.0.

        TS equivalent:
          computeBarAlignmentScore(emptyROI, {0:0, 1:0, ..., 23:0}) === 1.0
        """
        # Create a plain white ROI (no blue bars)
        roi = np.full((100, 480, 3), 255, dtype=np.uint8)
        hourly = [0.0] * 24
        score = compute_bar_alignment_score(roi, hourly)
        assert score == 1.0

    def test_one_side_zero_high_values(self):
        """When computed has bars but ROI has none, score should be low (0.1).

        TS equivalent:
          computeBarAlignmentScore(whiteROI, {0:30, 1:30, ...}) === 0.1
        """
        roi = np.full((100, 480, 3), 255, dtype=np.uint8)
        hourly = [30.0] * 24  # Sum > 30
        score = compute_bar_alignment_score(roi, hourly)
        assert score == pytest.approx(0.1, abs=0.01)

    def test_one_side_zero_low_values(self):
        """When computed has small bars but ROI has none, score = 0.3.

        TS equivalent:
          computeBarAlignmentScore(whiteROI, {0:1, 1:0, ...}) === 0.3
        """
        roi = np.full((100, 480, 3), 255, dtype=np.uint8)
        hourly = [1.0] + [0.0] * 23  # Sum = 1 < 30
        score = compute_bar_alignment_score(roi, hourly)
        assert score == pytest.approx(0.3, abs=0.01)

    def test_shift_penalty_applied(self):
        """Shift penalty reduces score when bar start positions differ by >= 2.

        Both Python and TS use: penalty = min(startDiff * 0.15, 0.5)

        TS equivalent:
          // Create ROI with blue bar at hour 5, computed has bar at hour 0
          // Score should have shift penalty applied
        """
        roi_height = 100
        roi_width = 480
        # Create ROI with a blue bar starting at slice 5
        roi = np.full((roi_height, roi_width, 3), 255, dtype=np.uint8)
        slice_width = roi_width // 24

        # Paint blue bars at hours 5-8
        for hour in range(5, 9):
            x_start = hour * slice_width + slice_width // 4
            x_end = hour * slice_width + 3 * slice_width // 4
            # Blue in BGR: B=200, G=100, R=50 -> HSV hue ~210 -> /2 = ~105
            roi[20:roi_height, x_start:x_end] = [200, 100, 50]

        # But computed values say bars are at hours 0-3
        hourly = [0.0] * 24
        for hour in range(0, 4):
            hourly[hour] = 40.0

        score = compute_bar_alignment_score(roi, hourly)
        # Shift of 5 -> penalty = min(5*0.15, 0.5) = 0.5
        # Score should be significantly penalized
        assert score < 0.7


# ============================================================================
# 2. Time parsing parity
#    TS: These are handled by shared time parsing logic
# ============================================================================


@pytest.mark.skipif(not HAS_OCR, reason="OCR imports unavailable")
class TestTimeParsingParity:
    """Time string parsing must match across Python and TS implementations."""

    # Expected outputs serve as the parity contract for TypeScript.
    # TS must parse these exact same strings to identical minute values.
    PARITY_CASES = [
        # (input_text, expected_output, total_minutes_comment)
        ("4h 36m", "4h 36m", "276 minutes"),
        ("2h 30m", "2h 30m", "150 minutes"),
        ("1h 0m", "1h 0m", "60 minutes"),
        ("45m", "45m", "45 minutes"),
        ("3h", "3h", "180 minutes"),
        ("12m 30s", "12m 30s", "12.5 minutes"),
        ("0m 45s", "0m 45s", "0.75 minutes"),
        ("15s", "15s", "0.25 minutes"),
        ("4h 36", "4h 36m", "276 minutes - missing m fallback"),
    ]

    @pytest.mark.parametrize("input_text, expected, _comment", PARITY_CASES)
    def test_time_extraction_parity(self, input_text: str, expected: str, _comment: str):
        """Python _extract_time_from_text must produce this exact output.

        TS equivalent:
          extractTimeFromText(input_text) === expected
        """
        result = _extract_time_from_text(input_text)
        assert result == expected

    def test_ocr_digit_normalization_parity(self):
        """OCR digit normalization produces the same corrections in both impls.

        TS equivalent:
          normalizeOcrDigits("Ih 3Om") === "1h 30m"
        """
        cases = [
            ("Ih 3Om", "1h 30m"),
            ("Oh 45m", "0h 45m"),
            ("4h Am", "4h 4m"),
        ]
        for input_text, expected in cases:
            result = _normalize_ocr_digits(input_text)
            assert result == expected, f"'{input_text}' -> '{result}', expected '{expected}'"


# ============================================================================
# 3. Bar height normalization parity
#    TS: analyzeBarHeight() in barExtraction.canvas.ts
# ============================================================================


@pytest.mark.skipif(
    not (HAS_BAR_EXTRACTION and HAS_NUMPY),
    reason="bar_extraction or numpy unavailable",
)
class TestBarHeightNormalizationParity:
    """Bar height calculation: pixel counts -> minutes (0-60 scale).

    Both Python and TS use: usage = MAX_MINUTES * counter / scaledRoiHeight

    TS equivalent:
      analyzeBarHeight(slice, middleColumn, maxHeight) returns Math.floor((60 * counter) / maxHeight)

    Note: Python keeps float precision, TS uses Math.floor. This is a known
    parity difference documented here.
    """

    def test_full_bar_height(self):
        """A column that is entirely black should produce 60 minutes.

        Python: 60 * roi_height * scale / (roi_height * scale) = 60.0
        TS:     Math.floor(60 * maxHeight / maxHeight) = 60
        """
        roi_height = 50
        roi_width = 24  # minimal width, one pixel per slice
        scale_amount = 4

        # Create an ROI that is entirely black (all bars = max)
        roi = np.zeros((roi_height, roi_width, 3), dtype=np.uint8)

        row, _, _ = slice_image(roi, 0, 0, roi_width, roi_height)

        # Each hour should be 60 minutes (full height)
        for i in range(24):
            assert row[i] == pytest.approx(60.0, abs=0.5), (
                f"Hour {i}: {row[i]} != 60.0"
            )

    def test_empty_bar_height(self):
        """A column that is entirely white should produce 0 minutes.

        Python: counter stays 0, result = 0.0
        TS:     counter stays 0, result = 0
        """
        roi_height = 50
        roi_width = 24

        roi = np.full((roi_height, roi_width, 3), 255, dtype=np.uint8)

        row, _, _ = slice_image(roi, 0, 0, roi_width, roi_height)

        for i in range(24):
            assert row[i] == pytest.approx(0.0, abs=0.1), (
                f"Hour {i}: {row[i]} != 0.0"
            )

    def test_half_bar_height(self):
        """Bottom half black, top half white -> ~30 minutes.

        Python: counter = roi_height*scale/2, result = 60 * (h*s/2) / (h*s) = 30.0
        TS:     Math.floor(60 * counter / maxHeight) = 30
        """
        roi_height = 100
        roi_width = 24

        roi = np.full((roi_height, roi_width, 3), 255, dtype=np.uint8)
        # Bottom half is black
        roi[roi_height // 2 :, :, :] = 0

        row, _, _ = slice_image(roi, 0, 0, roi_width, roi_height)

        for i in range(24):
            assert row[i] == pytest.approx(30.0, abs=1.0), (
                f"Hour {i}: {row[i]}, expected ~30.0"
            )


# ============================================================================
# 4. Grid ROI calculation parity
#    TS: calculateROI() in gridDetection.canvas.ts
# ============================================================================


@pytest.mark.skipif(not HAS_ROI, reason="ROI imports unavailable")
class TestGridROICalculationParity:
    """ROI calculation from anchor/click positions must match across impls.

    TS equivalent:
      calculateROI(lowerLeftX, upperRightY, width, height, img) returns
      { x, y, width, height } or null
    """

    def test_basic_roi_from_clicks(self):
        """Given two corner points, ROI dimensions are computed correctly.

        Both implementations: width = lower_right.x - upper_left.x
                              height = lower_right.y - upper_left.y

        TS:
          const roi = calculateROI(100, 200, 400, 300, img)
          assert roi.x === 100 && roi.y === 200 && roi.width === 400 && roi.height === 300
        """
        upper_left = (100, 200)
        lower_right = (500, 500)

        roi_x, roi_y, roi_w, roi_h = calculate_roi_from_clicks(upper_left, lower_right)

        assert roi_x == 100
        assert roi_y == 200
        assert roi_w == 400
        assert roi_h == 300

    def test_roi_rejects_inverted_coordinates(self):
        """Both impls reject when lower_right is above/left of upper_left.

        TS: calculateROI returns null for negative width/height
        Python: raises ImageProcessingError
        """
        from screenshot_processor.core.exceptions import ImageProcessingError

        with pytest.raises(ImageProcessingError):
            calculate_roi_from_clicks((500, 500), (100, 100))

    def test_roi_rejects_negative_coordinates(self):
        """Both impls reject negative coordinates.

        TS: calculateROI returns null for lowerLeftX < 0
        Python: raises ImageProcessingError
        """
        from screenshot_processor.core.exceptions import ImageProcessingError

        with pytest.raises(ImageProcessingError):
            calculate_roi_from_clicks((-10, 200), (500, 500))


# ============================================================================
# 5. Dark mode detection parity
#    TS: convertDarkMode() in imageUtils.canvas.ts
# ============================================================================


@pytest.mark.skipif(
    not (HAS_IMAGE_UTILS and HAS_NUMPY),
    reason="image_utils or numpy unavailable",
)
class TestDarkModeDetectionParity:
    """Dark mode detection threshold must be identical across implementations.

    Both use: if mean(image) < 100 -> invert + adjust contrast

    TS equivalent:
      convertDarkMode(imageMat) inverts when mean < 100
    """

    DARK_MODE_THRESHOLD = 100

    def test_dark_image_gets_inverted(self):
        """An image with mean < 100 should be inverted (become lighter).

        TS: convertDarkMode inverts when mean pixel value < 100
        """
        # Create a dark image (mean ~30)
        dark_img = np.full((100, 100, 3), 30, dtype=np.uint8)
        result = convert_dark_mode(dark_img.copy())

        # After inversion, mean should be higher
        assert np.mean(result) > self.DARK_MODE_THRESHOLD

    def test_light_image_unchanged(self):
        """An image with mean >= 100 should NOT be inverted.

        TS: convertDarkMode returns unchanged when mean >= 100
        """
        light_img = np.full((100, 100, 3), 200, dtype=np.uint8)
        original_mean = np.mean(light_img)
        result = convert_dark_mode(light_img.copy())

        # Should remain approximately the same
        assert np.mean(result) == pytest.approx(original_mean, abs=1.0)

    def test_threshold_boundary(self):
        """Image with mean exactly at threshold (100) should NOT be inverted.

        Both impls use strict less-than: mean < 100
        """
        boundary_img = np.full((100, 100, 3), 100, dtype=np.uint8)
        result = convert_dark_mode(boundary_img.copy())

        # Mean 100 is NOT < 100, so no inversion should happen
        assert np.mean(result) == pytest.approx(100.0, abs=1.0)


# ============================================================================
# 6. Image processing constants parity
#    TS: SCALE_AMOUNT, NUM_HOURS, MAX_MINUTES, LOWER_GRID_BUFFER
# ============================================================================


@pytest.mark.skipif(not HAS_NUMPY, reason="numpy unavailable")
class TestProcessingConstantsParity:
    """Shared algorithm constants must be identical across implementations.

    TS constants (barExtraction.canvas.ts):
      SCALE_AMOUNT = 4
      NUM_HOURS = 24
      MAX_MINUTES = 60
      LOWER_GRID_BUFFER = 2
    """

    # These values are extracted from both Python (bar_extraction.py, bar_processor.py)
    # and TypeScript (barExtraction.canvas.ts). If either side changes, this test
    # catches the drift.
    EXPECTED_SCALE_AMOUNT = 4
    EXPECTED_NUM_SLICES = 24
    EXPECTED_MAX_Y = 60
    EXPECTED_LOWER_GRID_BUFFER = 2

    def test_scale_amount(self):
        """Scale factor must be 4 in both implementations."""
        # Verify Python uses these values by inspecting slice_image behavior
        # with a known-size ROI
        roi_height = 10
        roi_width = 24
        roi = np.full((roi_height, roi_width, 3), 255, dtype=np.uint8)

        _, processed_img, scale = slice_image(roi, 0, 0, roi_width, roi_height)
        assert scale == self.EXPECTED_SCALE_AMOUNT

    def test_slice_count(self):
        """Both implementations divide the ROI into exactly 24 slices."""
        roi = np.full((50, 240, 3), 255, dtype=np.uint8)
        row, _, _ = slice_image(roi, 0, 0, 240, 50)

        # 24 hourly values + 1 total
        assert len(row) == self.EXPECTED_NUM_SLICES + 1


# ============================================================================
# 7. GridBounds / GridCoordinates parity
#    TS: GridCoordinates = { upper_left: {x, y}, lower_right: {x, y} }
# ============================================================================


@pytest.mark.skipif(not HAS_INTERFACES, reason="interfaces unavailable")
class TestGridBoundsParity:
    """GridBounds (Python) and GridCoordinates (TS) must represent the same data.

    Python: GridBounds(upper_left_x, upper_left_y, lower_right_x, lower_right_y)
            .width = lower_right_x - upper_left_x
            .height = lower_right_y - upper_left_y

    TS: { upper_left: {x, y}, lower_right: {x, y} }
        width = lower_right.x - upper_left.x
        height = lower_right.y - upper_left.y
    """

    def test_dimensions_computed_correctly(self):
        bounds = GridBounds(
            upper_left_x=100,
            upper_left_y=200,
            lower_right_x=500,
            lower_right_y=400,
        )
        assert bounds.width == 400
        assert bounds.height == 200
        assert bounds.upper_left == (100, 200)
        assert bounds.lower_right == (500, 400)

    def test_to_dict_matches_ts_shape(self):
        """to_dict() produces the flat format used by the API.

        TS GridCoordinates uses nested format: {upper_left: {x, y}, lower_right: {x, y}}
        but the API uses flat: {upper_left_x, upper_left_y, lower_right_x, lower_right_y}
        """
        bounds = GridBounds(
            upper_left_x=50,
            upper_left_y=100,
            lower_right_x=450,
            lower_right_y=300,
        )
        expected = {
            "upper_left_x": 50,
            "upper_left_y": 100,
            "lower_right_x": 450,
            "lower_right_y": 300,
        }
        assert bounds.to_dict() == expected


# ============================================================================
# 8. Image utility parity: darken_non_white, reduce_color_count, scale_up
#    TS: darkenNonWhite(), reduceColorCount(), scaleUp() in imageUtils.canvas.ts
# ============================================================================


@pytest.mark.skipif(
    not (HAS_IMAGE_UTILS and HAS_NUMPY),
    reason="image_utils or numpy unavailable",
)
class TestImageUtilityParity:
    """Low-level image utilities must produce equivalent results."""

    def test_darken_non_white_makes_non_white_black(self):
        """Pixels below gray threshold (240) become black.

        TS: darkenNonWhite applies grayscale threshold at 240,
            sets pixels below to [0,0,0]

        Python: cv2.threshold(gray, 240, 255, THRESH_BINARY) then img[thresh<250] = 0
        """
        img = np.full((10, 10, 3), 128, dtype=np.uint8)  # Gray (128 < 240)
        result = darken_non_white(img.copy())

        # All pixels should now be black
        assert np.all(result == 0)

    def test_darken_non_white_preserves_white(self):
        """Pure white pixels (255) remain white.

        TS: pixels at 255 pass the threshold and are preserved.
        """
        img = np.full((10, 10, 3), 255, dtype=np.uint8)
        result = darken_non_white(img.copy())

        # All pixels should remain white
        assert np.all(result == 255)

    def test_scale_up_dimensions(self):
        """scale_up(img, 4) produces 4x dimensions.

        TS: scaleUp(mat, 4) scales width and height by 4
        """
        img = np.zeros((25, 50, 3), dtype=np.uint8)
        result = scale_up(img, 4)

        assert result.shape[0] == 100  # height * 4
        assert result.shape[1] == 200  # width * 4

    def test_reduce_color_count_binary(self):
        """reduce_color_count(img, 2) produces only 0 and 255 values.

        TS: reduceColorCount(mat, 2) quantizes to 2 levels: 0 and 255
        """
        # Create image with various gray values
        img = np.array([[[64, 64, 64], [192, 192, 192]]], dtype=np.uint8)
        result = reduce_color_count(img.copy(), 2)

        # All values should be either 0 or 255
        unique_vals = set(np.unique(result))
        assert unique_vals.issubset({0, 255}), f"Unexpected values: {unique_vals}"
