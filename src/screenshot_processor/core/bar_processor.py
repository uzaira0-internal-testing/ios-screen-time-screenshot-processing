"""
Bar processor implementation.

This module provides the concrete implementation of IBarProcessor
for extracting hourly bar values from a grid region.
"""

from __future__ import annotations

import logging

import numpy as np

from .bar_extraction import compute_bar_alignment_score
from .image_utils import darken_non_white, reduce_color_count, remove_all_but, scale_up
from .interfaces import BarProcessingResult, GridBounds, IBarProcessor

logger = logging.getLogger(__name__)


class StandardBarProcessor(IBarProcessor):
    """
    Standard bar processor that extracts hourly values from a grid region.

    Uses the existing image processing pipeline to:
    1. Extract the ROI based on grid bounds
    2. Analyze bar heights in the ROI
    3. Compute alignment score
    """

    def extract(
        self,
        image: np.ndarray,
        bounds: GridBounds,
        is_battery: bool = False,
        use_fractional: bool = True,
    ) -> BarProcessingResult:
        """
        Extract hourly bar values from a grid region.

        Args:
            image: BGR image array (original, not preprocessed)
            bounds: The grid boundaries
            is_battery: Whether this is a battery screenshot
            use_fractional: If True, keep 2 decimal places; if False, round to int

        Returns:
            BarProcessingResult with hourly values if successful
        """
        try:
            roi_x = bounds.upper_left_x
            roi_y = bounds.upper_left_y
            roi_width = bounds.width
            roi_height = bounds.height

            if roi_x < 0 or roi_y < 0 or roi_width <= 0 or roi_height <= 0:
                return BarProcessingResult(
                    success=False,
                    error="Invalid ROI coordinates",
                )

            # Handle battery vs screen_time color extraction
            # IMPORTANT: For non-battery, use the RAW image (no dark mode conversion)
            # This matches the behavior in extract_hourly_data_only
            if is_battery:
                # For battery, we need to isolate the battery color
                img_raw = image.copy()
                # Remove all but battery color (dark blue)
                img_processed = remove_all_but(img_raw, np.array([255, 121, 0]))
                no_dark_blue = np.sum(255 - img_processed[roi_y : roi_y + roi_height, roi_x : roi_x + roi_width]) < 10
                if no_dark_blue:
                    # Dark mode - use inverted color
                    img_processed = remove_all_but(img_raw, np.array([0, 255 - 121, 255]))
            else:
                # For screen_time, use the raw image directly
                # slice_image will handle darken_non_white and reduce_color_count internally
                img_processed = image.copy()

            # Extract bar values using slice_image logic
            row = self._extract_bar_values(img_processed, roi_x, roi_y, roi_width, roi_height)

            if row is None or len(row) < 24:
                return BarProcessingResult(
                    success=False,
                    error="Failed to extract bar values from ROI",
                )

            # Convert row to hourly values dict (0-23)
            if use_fractional:
                # Keep 2 decimal places for precision
                hourly_values = {str(i): round(row[i], 2) for i in range(24)}
            else:
                # Round to integer (legacy behavior)
                hourly_values = {str(i): int(round(row[i])) for i in range(24)}

            # Compute alignment score using original image
            alignment_score = None
            try:
                roi = image[roi_y : roi_y + roi_height, roi_x : roi_x + roi_width]
                if roi.size > 0:
                    alignment_score = compute_bar_alignment_score(
                        roi,
                        [float(row[i]) for i in range(24)],
                    )
                    logger.debug(f"Bar alignment score: {alignment_score:.3f}")
            except Exception as e:
                logger.warning(f"Error computing alignment score: {e}")

            return BarProcessingResult(
                success=True,
                hourly_values=hourly_values,
                alignment_score=alignment_score,
            )

        except Exception as e:
            logger.error(f"Bar extraction failed: {e}")
            return BarProcessingResult(
                success=False,
                error=str(e),
            )

    def _extract_bar_values(
        self,
        img: np.ndarray,
        roi_x: int,
        roi_y: int,
        roi_width: int,
        roi_height: int,
    ) -> list[float]:
        """
        Extract hourly values from the ROI using the slice_image algorithm.

        This replicates the exact algorithm from image_processor.slice_image:
        - Scans each slice column from TOP to BOTTOM
        - Counts consecutive black pixels
        - Resets counter when hitting a white pixel (except near bottom)
        """
        num_slices = 24
        max_y = 60
        scale_amount = 4
        lower_grid_buffer = 2

        # Extract ROI
        roi = img[roi_y : roi_y + roi_height, roi_x : roi_x + roi_width]

        # Process ROI - convert to black/white for bar detection
        roi_processed = darken_non_white(roi.copy())
        roi_processed = reduce_color_count(roi_processed, 2)

        # Scale up for more precise measurement
        roi_scaled = scale_up(roi_processed, scale_amount)

        scaled_roi_height = roi_height * scale_amount
        scaled_roi_width = roi_width * scale_amount
        slice_width = scaled_roi_width // num_slices

        row = []

        for slice_index in range(num_slices):
            slice_x = slice_index * slice_width

            # Get the middle column of this slice (matches original algorithm)
            middle_col = slice_x + slice_width // 2
            if middle_col >= scaled_roi_width:
                middle_col = scaled_roi_width - 1

            # Extract single column
            column = roi_scaled[:, middle_col, :]

            # Detect black pixels (bar) and white pixels (background)
            # Black pixels: sum of RGB channels == 0
            pixel_sums = np.sum(column, axis=1)
            is_black = pixel_sums == 0
            # White pixels: all channels within 2 of 255
            is_white = np.all(np.abs(column.astype(np.int16) - 255) <= 2, axis=1)

            # Count bar height - scan TOP to BOTTOM, reset on white
            counter = 0
            for y_coord in range(scaled_roi_height):
                if is_black[y_coord]:
                    counter += 1
                if is_white[y_coord] and y_coord < scaled_roi_height - lower_grid_buffer:
                    counter = 0  # Reset when hitting white (except near bottom)

            # Keep as float - rounding happens later based on config
            usage_at_time = max_y * counter / scaled_roi_height
            row.append(usage_at_time)

        # Add total (sum of all values)
        row.append(sum(row))

        return row


def get_bar_processor() -> IBarProcessor:
    """Factory function to get the default bar processor."""
    return StandardBarProcessor()
