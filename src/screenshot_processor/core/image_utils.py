from __future__ import annotations

import logging

import cv2
import numpy as np

from .models import LineExtractionMode

logger = logging.getLogger(__name__)

DEBUG_ENABLED = False


def convert_dark_mode(img: np.ndarray) -> np.ndarray:
    dark_mode_threshold = 100
    # cv2.mean() is SIMD C++ — ~3x faster than np.mean() on images
    channel_means = cv2.mean(img)
    avg = sum(channel_means[:3]) / 3.0 if len(img.shape) == 3 else channel_means[0]
    if avg < dark_mode_threshold:
        cv2.bitwise_not(img, dst=img)
        img = adjust_contrast_brightness(img, 3.0, 10)

    return img


def adjust_contrast_brightness(img: np.ndarray, contrast: float = 1.0, brightness: int = 0) -> np.ndarray:
    brightness += int(round(255 * (1 - contrast) / 2))
    return cv2.addWeighted(img, contrast, img, 0, brightness)


def get_pixel(img: np.ndarray, arg: int) -> np.ndarray | None:
    unq, count = np.unique(img.reshape(-1, img.shape[-1]), axis=0, return_counts=True)
    sort = np.argsort(count)
    sorted_unq = unq[sort]
    if len(sorted_unq) <= 1:
        return None
    if np.abs(arg) >= len(sorted_unq):
        return sorted_unq[0]
    return sorted_unq[arg]


def is_close(pixel_1: np.ndarray | list[int], pixel_2: np.ndarray | list[int], thresh: int = 1) -> bool:
    return np.sum(np.abs(pixel_1 - pixel_2)) <= thresh * len(pixel_1)


def reduce_color_count(img: np.ndarray, num_colors: int) -> np.ndarray:
    # Use OpenCV LUT for SIMD-optimized color quantization.
    # Build a 256-entry lookup table mapping each value to its quantized bin.
    input_vals = np.arange(256, dtype=np.float64)
    bin_indices = np.clip((input_vals * num_colors / 255).astype(int), 0, num_colors - 1)
    output_vals = (bin_indices * 255 / (num_colors - 1)).astype(np.uint8)
    # Only values in [i*255/n, (i+1)*255/n) are mapped; values >= last boundary
    # are left untouched (identity).
    lut = np.arange(256, dtype=np.uint8)
    boundary = num_colors * 255.0 / num_colors
    mapped = input_vals < boundary
    lut[mapped] = output_vals[mapped]
    # cv2.LUT is SIMD-optimized C++ — faster than np.take for image LUT ops.
    cv2.LUT(img, lut, dst=img)
    return img


def remove_all_but(img: np.ndarray, color: np.ndarray, threshold: int = 30):
    # Squared L2 distance avoids sqrt (faster than np.linalg.norm).
    # threshold² comparison is equivalent to threshold comparison on norm.
    diff = img.astype(np.int16) - color.astype(np.int16)
    sq_dist = (diff * diff).sum(axis=2)
    mask = sq_dist <= threshold * threshold
    img[mask] = [0, 0, 0]
    img[~mask] = [255, 255, 255]
    return img


def darken_non_white(img: np.ndarray) -> np.ndarray:
    # Convert to grayscale, then zero out all non-white pixels using SIMD ops.
    # cv2.threshold + cv2.bitwise_and are compiled C++ with SIMD — much faster
    # than numpy boolean fancy indexing (img[mask] = 0).
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)
    # mask: 255 where gray > 240 (white, keep), 0 where gray <= 240 (darken)
    # bitwise_and with 3-channel mask: keeps white pixels, zeros the rest
    mask_3ch = cv2.merge((mask, mask, mask))
    cv2.bitwise_and(img, mask_3ch, dst=img)
    return img


def scale_up(img, scale_amount):
    width = int(img.shape[1] * scale_amount)
    height = int(img.shape[0] * scale_amount)
    dim = (width, height)

    return cv2.resize(img, dim, interpolation=cv2.INTER_AREA)


def remove_line_color(img: np.ndarray) -> np.ndarray:
    line_color = np.array([203, 199, 199], dtype=np.int16)
    # Vectorized: compute per-pixel L1 distance to line_color, threshold <= 3 (len*thresh)
    diff = np.abs(img.astype(np.int16) - line_color)
    distances = diff.sum(axis=2)
    img[distances <= 3] = 255
    return img


def show_until_destroyed(img_name: str, img: np.ndarray) -> None:
    cv2.imshow(img_name, img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


def extract_line(img, x0: int, x1: int, y0: int, y1: int, line_extraction_mode: LineExtractionMode) -> int:
    sub_image = img[y0:y1, x0:x1]

    sub_image = reduce_color_count(sub_image, 2)
    pixel_value = get_pixel(sub_image, -2)
    if pixel_value is None:
        return 0

    if DEBUG_ENABLED:
        cv2.imshow("img", sub_image)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    # Vectorized pixel matching: L1 distance per pixel <= threshold (len * 1)
    pixel_ref = pixel_value.astype(np.int16)
    diff = np.abs(sub_image.astype(np.int16) - pixel_ref)
    close_mask = diff.sum(axis=2) <= len(pixel_value)  # is_close with thresh=1

    if line_extraction_mode == LineExtractionMode.HORIZONTAL:
        row_scores = close_mask.sum(axis=1)
        matches = np.where(row_scores > 0.5 * sub_image.shape[1])[0]
        return int(matches[0]) if len(matches) > 0 else 0

    elif line_extraction_mode == LineExtractionMode.VERTICAL:
        col_scores = close_mask.sum(axis=0)
        matches = np.where(col_scores > 0.25 * sub_image.shape[0])[0]
        return int(matches[0]) if len(matches) > 0 else 0

    else:
        msg = "Invalid mode for line extraction"
        raise ValueError(msg)


def extract_line_snap_to_grid(
    img: np.ndarray,
    x0: int,
    x1: int,
    y0: int,
    y1: int,
    line_extraction_mode: LineExtractionMode,
    grid_color: np.ndarray | None = None,
):
    sub_image = img[y0:y1, x0:x1].copy()

    is_battery = False
    if grid_color is not None and is_battery:
        pixel_value = grid_color
        sub_image = remove_all_but(sub_image, pixel_value, 100)
        pixel_value = [0, 0, 0]
    else:
        sub_image = reduce_color_count(sub_image, 2)
        pixel_value = get_pixel(sub_image, -2)

        if pixel_value is None:
            return None

    if DEBUG_ENABLED or grid_color is not None:
        cv2.imshow("img", sub_image)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    count_color = np.asarray(pixel_value, dtype=np.int16)

    # Vectorized pixel matching
    diff = np.abs(sub_image.astype(np.int16) - count_color)
    close_mask = diff.sum(axis=2) <= len(count_color)

    if line_extraction_mode == LineExtractionMode.HORIZONTAL:
        row_scores = close_mask.sum(axis=1)
        matches = np.where(row_scores > 0.7 * sub_image.shape[1])[0]
        return int(matches[0]) if len(matches) > 0 else None

    if line_extraction_mode == LineExtractionMode.VERTICAL:
        col_scores = close_mask.sum(axis=0)
        matches = np.where(col_scores > 0.3 * sub_image.shape[0])[0]
        return int(matches[0]) if len(matches) > 0 else None
    return None
