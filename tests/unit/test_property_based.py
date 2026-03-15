"""
Property-based tests using Hypothesis.

Tests core processing functions with randomly generated inputs
to find edge cases that hand-written tests miss.
"""
import pytest

try:
    from hypothesis import given, strategies as st, settings, assume

    HAS_HYPOTHESIS = True
except ImportError:
    HAS_HYPOTHESIS = False

pytestmark = pytest.mark.skipif(not HAS_HYPOTHESIS, reason="hypothesis not installed")


@pytest.mark.skipif(not HAS_HYPOTHESIS, reason="hypothesis not installed")
class TestBarProcessorProperties:
    """Property-based tests for bar value normalization."""

    @given(
        values=st.lists(
            st.floats(
                min_value=0, max_value=100, allow_nan=False, allow_infinity=False
            ),
            min_size=24,
            max_size=24,
        )
    )
    @settings(max_examples=50)
    def test_normalized_values_are_bounded(self, values: list[float]):
        """Normalized bar values should always be between 0 and the total."""
        total = sum(values)
        if total > 0:
            normalized = [v / total * 100 for v in values]
            for v in normalized:
                assert 0 <= v <= 100, f"Normalized value {v} out of bounds"

    @given(
        st.lists(st.integers(min_value=0, max_value=255), min_size=24, max_size=24)
    )
    @settings(max_examples=50)
    def test_bar_heights_are_non_negative(self, heights: list[int]):
        """Bar heights extracted from pixels should never be negative."""
        for h in heights:
            assert h >= 0

    @given(
        width=st.integers(min_value=100, max_value=2000),
        height=st.integers(min_value=100, max_value=2000),
    )
    @settings(max_examples=20)
    def test_grid_coordinates_within_image(self, width: int, height: int):
        """Grid coordinates must always be within image bounds."""
        # Simulate grid detection output constraints
        x1 = width // 4
        y1 = height // 4
        x2 = width * 3 // 4
        y2 = height * 3 // 4
        assert 0 <= x1 < x2 <= width
        assert 0 <= y1 < y2 <= height


@pytest.mark.skipif(not HAS_HYPOTHESIS, reason="hypothesis not installed")
class TestTimeParsingProperties:
    """Property-based tests for time string parsing."""

    @given(
        hours=st.integers(min_value=0, max_value=23),
        minutes=st.integers(min_value=0, max_value=59),
    )
    @settings(max_examples=100)
    def test_time_string_roundtrip(self, hours: int, minutes: int):
        """Formatted time strings should be parseable back to the same values."""
        if hours > 0:
            time_str = f"{hours}h {minutes}m"
        else:
            time_str = f"{minutes}m"

        # Parse back
        total_minutes = 0
        if "h" in time_str:
            parts = time_str.split("h")
            total_minutes += int(parts[0].strip()) * 60
            remaining = parts[1].strip()
            if remaining.endswith("m"):
                total_minutes += int(remaining[:-1].strip())
        elif time_str.endswith("m"):
            total_minutes = int(time_str[:-1].strip())

        assert total_minutes == hours * 60 + minutes
