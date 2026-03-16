//! Image utility functions — Rust port of Python image_utils.py.
//!
//! All functions operate on `image::RgbImage` (RGB format).
//! Python/OpenCV uses BGR; we convert at load boundaries only.

use image::{Rgb, RgbImage};

/// Dark mode detection threshold (mean pixel value).
const DARK_MODE_THRESHOLD: f64 = 100.0;

/// Detect and convert dark mode screenshots to light mode.
///
/// If the mean pixel value is below threshold, inverts all pixels
/// and applies contrast=3.0, brightness=10.
pub fn convert_dark_mode(img: &mut RgbImage) -> bool {
    let mean = image_mean(img);
    if mean < DARK_MODE_THRESHOLD {
        // Invert all pixels
        for pixel in img.pixels_mut() {
            pixel[0] = 255 - pixel[0];
            pixel[1] = 255 - pixel[1];
            pixel[2] = 255 - pixel[2];
        }
        // Apply contrast/brightness adjustment
        *img = adjust_contrast_brightness(img, 3.0, 10);
        true
    } else {
        false
    }
}

/// Compute mean pixel value across all channels.
fn image_mean(img: &RgbImage) -> f64 {
    let (mut sum, mut count) = (0u64, 0u64);
    for pixel in img.pixels() {
        sum += pixel[0] as u64 + pixel[1] as u64 + pixel[2] as u64;
        count += 3;
    }
    if count == 0 {
        return 0.0;
    }
    sum as f64 / count as f64
}

/// Adjust contrast and brightness.
///
/// Equivalent to Python:
///   brightness += int(round(255 * (1 - contrast) / 2))
///   cv2.addWeighted(img, contrast, img, 0, brightness)
pub fn adjust_contrast_brightness(img: &RgbImage, contrast: f64, brightness: i32) -> RgbImage {
    let adjusted_brightness = brightness as f64 + (255.0 * (1.0 - contrast) / 2.0).round();

    // Pre-compute LUT for the contrast+brightness transform (avoids float math per pixel)
    let mut lut = [0u8; 256];
    for i in 0..256 {
        let val = (i as f64 * contrast + adjusted_brightness).round();
        lut[i] = val.clamp(0.0, 255.0) as u8;
    }

    let mut out = img.clone();
    let raw = out.as_mut();
    for byte in raw.iter_mut() {
        *byte = lut[*byte as usize];
    }
    out
}

/// Build a color quantization LUT that maps each value to its quantized bin.
///
/// Equivalent to Python reduce_color_count: builds a 256-entry lookup table
/// and applies it to every pixel channel.
pub fn reduce_color_count(img: &mut RgbImage, num_colors: u32) {
    // Build 256-entry LUT (stack-allocated).
    // Maps each input value [0..255] to its nearest quantized bin center.
    let mut lut = [0u8; 256];
    let nc = num_colors as f64;

    for i in 0..256u32 {
        let bin = ((i as f64 * nc / 255.0) as u32).min(num_colors - 1);
        lut[i as usize] = (bin * 255 / (num_colors - 1)) as u8;
    }

    // Apply LUT to raw buffer (avoids per-pixel Rgb struct overhead)
    let raw = img.as_mut();
    for byte in raw.iter_mut() {
        *byte = lut[*byte as usize];
    }
}

/// Keep only pixels matching `color` within `threshold` (squared L2 distance),
/// set matching → black, non-matching → white.
///
/// Port of Python `remove_all_but(img, color, threshold=30)`.
pub fn remove_all_but(img: &mut RgbImage, color: [u8; 3], threshold: i32) {
    let threshold_sq = threshold * threshold;
    let cr = color[0] as i32;
    let cg = color[1] as i32;
    let cb = color[2] as i32;

    let raw = img.as_mut();
    let len = raw.len();
    let mut i = 0;
    while i + 2 < len {
        let dr = raw[i] as i32 - cr;
        let dg = raw[i + 1] as i32 - cg;
        let db = raw[i + 2] as i32 - cb;
        let sq_dist = dr * dr + dg * dg + db * db;

        if sq_dist <= threshold_sq {
            raw[i] = 0;
            raw[i + 1] = 0;
            raw[i + 2] = 0;
        } else {
            raw[i] = 255;
            raw[i + 1] = 255;
            raw[i + 2] = 255;
        }
        i += 3;
    }
}

/// Zero out all non-white pixels (gray value ≤ 240 → black).
///
/// Port of Python `darken_non_white(img)`.
/// Uses raw buffer access for speed.
pub fn darken_non_white(img: &mut RgbImage) {
    let raw = img.as_mut();
    let len = raw.len();
    let mut i = 0;
    while i + 2 < len {
        let gray = (raw[i] as u16 + raw[i + 1] as u16 + raw[i + 2] as u16) / 3;
        if gray <= 240 {
            raw[i] = 0;
            raw[i + 1] = 0;
            raw[i + 2] = 0;
        }
        i += 3;
    }
}

/// Find the Nth most common pixel value in an image region.
///
/// Port of Python `get_pixel(img, arg)`.
/// `arg` is an index into the sorted-by-count unique pixels.
/// arg=-2 means second most common pixel.
pub fn get_pixel(img: &RgbImage, arg: i32) -> Option<[u8; 3]> {
    use std::collections::HashMap;

    let mut counts: HashMap<[u8; 3], u32> = HashMap::new();
    for pixel in img.pixels() {
        *counts.entry([pixel[0], pixel[1], pixel[2]]).or_insert(0) += 1;
    }

    if counts.len() <= 1 {
        return None;
    }

    let mut sorted: Vec<_> = counts.into_iter().collect();
    sorted.sort_by_key(|(_, count)| *count);

    let idx = if arg < 0 {
        let abs_idx = (-arg) as usize;
        if abs_idx > sorted.len() {
            0
        } else {
            sorted.len() - abs_idx
        }
    } else {
        (arg as usize).min(sorted.len() - 1)
    };

    Some(sorted[idx].0)
}

/// Check if two pixels are close (L1 distance ≤ thresh * channels).
pub fn is_close(p1: &[u8; 3], p2: &[u8; 3], thresh: i32) -> bool {
    let dist: i32 = (p1[0] as i32 - p2[0] as i32).abs()
        + (p1[1] as i32 - p2[1] as i32).abs()
        + (p1[2] as i32 - p2[2] as i32).abs();
    dist <= thresh * 3
}

/// Extract line position from a subregion.
///
/// Port of Python `extract_line(img, x0, x1, y0, y1, mode)`.
/// Returns the position of the first row/column where the 2nd-most-common
/// pixel dominates.
pub fn extract_line(
    img: &RgbImage,
    x0: u32,
    x1: u32,
    y0: u32,
    y1: u32,
    horizontal: bool,
) -> u32 {
    let sub = image::imageops::crop_imm(img, x0, y0, x1 - x0, y1 - y0).to_image();
    let mut sub_processed = sub.clone();
    reduce_color_count(&mut sub_processed, 2);

    let pixel_value = match get_pixel(&sub_processed, -2) {
        Some(p) => p,
        None => return 0,
    };

    let (sw, sh) = sub_processed.dimensions();

    if horizontal {
        // Find first row where >50% of pixels match
        for y in 0..sh {
            let mut count = 0u32;
            for x in 0..sw {
                let p = sub_processed.get_pixel(x, y);
                if is_close(&[p[0], p[1], p[2]], &pixel_value, 1) {
                    count += 1;
                }
            }
            if count > sw / 2 {
                return y;
            }
        }
    } else {
        // Find first column where >25% of pixels match
        for x in 0..sw {
            let mut count = 0u32;
            for y in 0..sh {
                let p = sub_processed.get_pixel(x, y);
                if is_close(&[p[0], p[1], p[2]], &pixel_value, 1) {
                    count += 1;
                }
            }
            if count > sh / 4 {
                return x;
            }
        }
    }

    0
}

/// Remove grid line color pixels (set to white).
///
/// Port of Python `remove_line_color(img)`.
pub fn remove_line_color(img: &mut RgbImage) {
    // Line color in RGB (Python uses BGR [203, 199, 199] → RGB [199, 199, 203])
    let line_r = 199i32;
    let line_g = 199i32;
    let line_b = 203i32;

    for pixel in img.pixels_mut() {
        let dist = (pixel[0] as i32 - line_r).abs()
            + (pixel[1] as i32 - line_g).abs()
            + (pixel[2] as i32 - line_b).abs();
        if dist <= 3 {
            *pixel = Rgb([255, 255, 255]);
        }
    }
}

/// Convert RGB image to HSV representation.
///
/// Returns a Vec of (h, s, v) tuples matching the image dimensions.
/// H: 0–180 (matching OpenCV convention), S: 0–255, V: 0–255.
pub fn rgb_to_hsv(r: u8, g: u8, b: u8) -> (u8, u8, u8) {
    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;

    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let diff = max - min;

    let h = if diff == 0.0 {
        0.0
    } else if max == rf {
        60.0 * (((gf - bf) / diff) % 6.0)
    } else if max == gf {
        60.0 * ((bf - rf) / diff + 2.0)
    } else {
        60.0 * ((rf - gf) / diff + 4.0)
    };

    let h = if h < 0.0 { h + 360.0 } else { h };
    let h = (h / 2.0) as u8; // Scale to 0–180 (OpenCV convention)

    let s = if max == 0.0 {
        0.0
    } else {
        (diff / max) * 255.0
    };

    let v = max * 255.0;

    (h, s as u8, v as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_darken_non_white() {
        let mut img = RgbImage::new(3, 1);
        img.put_pixel(0, 0, Rgb([255, 255, 255])); // white — keep
        img.put_pixel(1, 0, Rgb([100, 100, 100])); // gray — darken
        img.put_pixel(2, 0, Rgb([250, 250, 250])); // near-white — keep

        darken_non_white(&mut img);

        assert_eq!(img.get_pixel(0, 0), &Rgb([255, 255, 255]));
        assert_eq!(img.get_pixel(1, 0), &Rgb([0, 0, 0]));
        assert_eq!(img.get_pixel(2, 0), &Rgb([250, 250, 250]));
    }

    #[test]
    fn test_reduce_color_count_binary() {
        let mut img = RgbImage::new(4, 1);
        img.put_pixel(0, 0, Rgb([0, 0, 0]));
        img.put_pixel(1, 0, Rgb([50, 50, 50]));
        img.put_pixel(2, 0, Rgb([200, 200, 200]));
        img.put_pixel(3, 0, Rgb([255, 255, 255]));

        reduce_color_count(&mut img, 2);

        // Should quantize to 0 or 255
        let p0 = img.get_pixel(0, 0);
        let p3 = img.get_pixel(3, 0);
        assert_eq!(p0[0], 0);
        assert_eq!(p3[0], 255);
    }

    #[test]
    fn test_remove_all_but() {
        let mut img = RgbImage::new(3, 1);
        img.put_pixel(0, 0, Rgb([255, 121, 0])); // target color
        img.put_pixel(1, 0, Rgb([255, 120, 1])); // close — within threshold
        img.put_pixel(2, 0, Rgb([0, 0, 255])); // far — outside threshold

        remove_all_but(&mut img, [255, 121, 0], 30);

        assert_eq!(img.get_pixel(0, 0), &Rgb([0, 0, 0])); // matching → black
        assert_eq!(img.get_pixel(1, 0), &Rgb([0, 0, 0])); // close → black
        assert_eq!(img.get_pixel(2, 0), &Rgb([255, 255, 255])); // far → white
    }

    #[test]
    fn test_adjust_contrast_brightness() {
        let mut img = RgbImage::new(1, 1);
        img.put_pixel(0, 0, Rgb([128, 128, 128]));

        let result = adjust_contrast_brightness(&img, 2.0, 0);
        let p = result.get_pixel(0, 0);
        // contrast=2.0: brightness += round(255*(1-2)/2) = -128
        // val = 128 * 2.0 + (-128) = 128
        assert_eq!(p[0], 128);
    }

    #[test]
    fn test_convert_dark_mode_detects_dark() {
        // Create a dark image (mean < 100)
        let mut img = RgbImage::from_fn(10, 10, |_, _| Rgb([30, 30, 30]));
        let was_dark = convert_dark_mode(&mut img);
        assert!(was_dark);
        // Should no longer be dark after conversion
        let mean = image_mean(&img);
        assert!(mean > 100.0);
    }

    #[test]
    fn test_convert_dark_mode_ignores_light() {
        let mut img = RgbImage::from_fn(10, 10, |_, _| Rgb([200, 200, 200]));
        let was_dark = convert_dark_mode(&mut img);
        assert!(!was_dark);
    }

    #[test]
    fn test_is_close() {
        assert!(is_close(&[100, 100, 100], &[101, 101, 101], 1));
        assert!(!is_close(&[100, 100, 100], &[110, 110, 110], 1));
    }

    #[test]
    fn test_rgb_to_hsv_blue() {
        let (h, s, v) = rgb_to_hsv(0, 0, 255);
        // Blue should be around H=120 (in OpenCV 0-180 scale)
        assert!(h >= 115 && h <= 125, "H={h}, expected ~120");
        assert_eq!(s, 255);
        assert_eq!(v, 255);
    }
}
