from __future__ import annotations

import logging

import cv2
import numpy as np

from .models import LineExtractionMode

logger = logging.getLogger(__name__)

DEBUG_ENABLED = False


def convert_dark_mode(img: np.ndarray) -> np.ndarray:
    dark_mode_threshold = 100
    if np.mean(img) < dark_mode_threshold:
        img = 255 - img
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
    # Build a 256-entry lookup table (LUT) that maps each input value to its
    # quantized output value — identical to the original per-bin loop but done
    # in a single vectorised pass via np.take / fancy indexing.
    input_vals = np.arange(256, dtype=np.float64)
    bin_indices = np.clip((input_vals * num_colors / 255).astype(int), 0, num_colors - 1)
    output_vals = (bin_indices * 255 / (num_colors - 1)).astype(np.uint8)
    # Ensure exact parity: the original loop excludes the upper boundary of
    # the last bin (values == 255 when 255 == num_colors * 255 / num_colors),
    # so 255 may stay unmapped.  Replicate that: only values in
    # [i*255/n, (i+1)*255/n) are mapped; values >= num_colors*255/num_colors
    # are left untouched.
    lut = np.arange(256, dtype=np.uint8)  # identity by default (untouched)
    for i in range(num_colors):
        lo = i * 255 / num_colors
        hi = (i + 1) * 255 / num_colors
        mask = (input_vals >= lo) & (input_vals < hi)
        lut[mask] = output_vals[mask]
    # Apply the LUT in one shot — works on any shape, any dtype(uint8).
    np.take(lut, img, out=img)
    return img


def remove_all_but(img: np.ndarray, color: np.ndarray, threshold: int = 30):
    distances = np.linalg.norm(img - color, axis=2)
    mask = distances <= threshold
    img[mask] = [0, 0, 0]
    img[~mask] = [255, 255, 255]
    return img


def darken_non_white(img: np.ndarray) -> np.ndarray:
    # Fused grayscale + threshold in one pass using vectorized weighted sum.
    # cv2.COLOR_BGR2GRAY weights: B*0.114 + G*0.587 + R*0.299
    # We compute the gray value and threshold (>240) directly, avoiding the
    # intermediate gray array allocation + separate threshold call.
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Single boolean mask instead of thresh + comparison
    img[gray <= 240] = 0
    return img


def scale_up(img, scale_amount):
    width = int(img.shape[1] * scale_amount)
    height = int(img.shape[0] * scale_amount)
    dim = (width, height)

    return cv2.resize(img, dim, interpolation=cv2.INTER_AREA)


def remove_line_color(img: np.ndarray) -> np.ndarray:
    line_color = np.array([203, 199, 199])
    shape = np.shape(img)

    for i in range(shape[0]):
        for j in range(shape[1]):
            pixel = img[i, j]
            if is_close(pixel, line_color):
                img[i, j] = [255, 255, 255]

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

    if line_extraction_mode == LineExtractionMode.HORIZONTAL:
        shape = np.shape(sub_image)

        for i in range(shape[0]):
            row_score = 0
            for j in range(shape[1]):
                pixel = sub_image[i, j]
                if is_close(pixel, pixel_value):
                    row_score = row_score + 1
            if row_score > 0.5 * shape[1]:
                return i
        return 0

    elif line_extraction_mode == LineExtractionMode.VERTICAL:
        shape = np.shape(sub_image)
        for j in range(shape[1]):
            col_score = 0
            for i in range(shape[0]):
                pixel = sub_image[i, j]
                if is_close(pixel, pixel_value):
                    col_score = col_score + 1

            if col_score > 0.25 * shape[0]:
                return j
        return 0

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

    count_color = pixel_value

    if line_extraction_mode == LineExtractionMode.HORIZONTAL:
        shape = np.shape(sub_image)

        for i in range(shape[0]):
            row_score = 0
            for j in range(shape[1]):
                pixel = sub_image[i, j]
                if is_close(pixel, count_color):
                    row_score = row_score + 1
            if row_score > 0.7 * shape[1]:
                return i

    if line_extraction_mode == LineExtractionMode.VERTICAL:
        shape = np.shape(sub_image)
        for j in range(shape[1]):
            col_score = 0
            for i in range(shape[0]):
                pixel = sub_image[i, j]
                if is_close(pixel, count_color):
                    col_score = col_score + 1

            if col_score > 0.3 * shape[0]:
                return j
        return None
    return None
