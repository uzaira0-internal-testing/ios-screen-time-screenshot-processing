//! Bar graph value extraction from ROI regions.
//!
//! Port of Python bar_extraction.py — extracts 24 hourly usage values
//! by analyzing pixel colors and measuring bar heights.

use image::RgbImage;

use super::image_utils::{darken_and_binarize, rgb_to_hsv};

/// Number of hourly slices in the bar graph.
const NUM_SLICES: usize = 24;
/// Maximum minutes per hour (y-axis ceiling).
const MAX_Y: f64 = 60.0;
/// Pixels to exclude at the bottom of the ROI (grid line buffer).
const LOWER_GRID_BUFFER: usize = 2;

/// Extract hourly usage values from the bar graph region.
///
/// Returns a Vec of 25 elements: 24 hourly values + total.
///
/// Port of Python `slice_image()`.
pub fn slice_image(
    img: &RgbImage,
    roi_x: u32,
    roi_y: u32,
    roi_width: u32,
    roi_height: u32,
) -> Vec<f64> {
    // Clamp ROI to image bounds to prevent silent truncation
    let (img_w, img_h) = img.dimensions();
    let roi_x = roi_x.min(img_w);
    let roi_y = roi_y.min(img_h);
    let roi_width = roi_width.min(img_w.saturating_sub(roi_x));
    let roi_height = roi_height.min(img_h.saturating_sub(roi_y));

    if roi_width < NUM_SLICES as u32 || roi_height < 2 {
        // ROI too small to extract meaningful data — return zeros
        return vec![0.0; NUM_SLICES + 1];
    }

    // Extract ROI and process: fused darken + binarize in a single pass
    let mut roi_processed = image::imageops::crop_imm(img, roi_x, roi_y, roi_width, roi_height).to_image();
    darken_and_binarize(&mut roi_processed);

    let h = roi_height as usize;
    let rw = roi_width as usize;
    let slice_width = rw / NUM_SLICES;

    // reset_limit: exclude bottom 2 pixels (grid line buffer at original resolution).
    // Python divides by scale_amount because it scaled up first, but we work at
    // original resolution, so use LOWER_GRID_BUFFER directly.
    let reset_limit = h.saturating_sub(LOWER_GRID_BUFFER).max(1);

    let mut row = Vec::with_capacity(NUM_SLICES + 1);

    // Use raw buffer for direct pixel access (3 bytes per pixel)
    let raw = roi_processed.as_raw();
    let stride = rw * 3;

    for s in 0..NUM_SLICES {
        // Middle column of this slice
        let mid_col = (s * slice_width + slice_width / 2).min(rw - 1);

        // Find last white pixel row (scanning from bottom up)
        let mut start_after: usize = 0;
        for y in (0..reset_limit).rev() {
            let idx = y * stride + mid_col * 3;
            // White check: all channels >= 253
            if raw[idx] >= 253 && raw[idx + 1] >= 253 && raw[idx + 2] >= 253 {
                start_after = y + 1;
                break;
            }
        }

        // Count black pixels below start_after
        let mut counter = 0u32;
        for y in start_after..h {
            let idx = y * stride + mid_col * 3;
            // Black check: sum of channels == 0
            if raw[idx] as u16 + raw[idx + 1] as u16 + raw[idx + 2] as u16 == 0 {
                counter += 1;
            }
        }

        let value = MAX_Y * counter as f64 / h as f64;
        row.push(value);
    }

    // Append total
    let total: f64 = row.iter().sum();
    row.push(total);

    row
}

/// Compute alignment score between visual bar graph and computed values.
///
/// Returns a score from 0.0 to 1.0 where 1.0 = perfect alignment.
///
/// Port of Python `compute_bar_alignment_score()`.
pub fn compute_bar_alignment_score(roi: &RgbImage, hourly_values: &[f64]) -> f64 {
    let (roi_width, roi_height) = roi.dimensions();
    if roi_width == 0 || roi_height == 0 {
        return 0.0;
    }

    // Ensure exactly 24 values
    let mut values = vec![0.0f64; 24];
    for (i, &v) in hourly_values.iter().take(24).enumerate() {
        values[i] = v;
    }

    let slice_width = roi_width as usize / NUM_SLICES;

    // Extract bar heights from image using HSV blue detection (raw buffer access)
    let raw = roi.as_raw();
    let stride = roi_width as usize * 3;
    let mut extracted_heights = Vec::with_capacity(NUM_SLICES);

    for i in 0..NUM_SLICES {
        let mid_start = i * slice_width + slice_width / 4;
        let mid_end = (i * slice_width + 3 * slice_width / 4).min(roi_width as usize);

        let mut first_blue_row: Option<usize> = None;

        for y in 0..roi_height as usize {
            let row_off = y * stride;
            let mut has_blue = false;
            for x in mid_start..mid_end {
                let idx = row_off + x * 3;
                let (h, s, v) = rgb_to_hsv(raw[idx], raw[idx + 1], raw[idx + 2]);
                if h >= 90 && h <= 130 && s > 50 && v > 100 {
                    has_blue = true;
                    break;
                }
            }
            if has_blue {
                first_blue_row = Some(y);
                break;
            }
        }

        let bar_height = match first_blue_row {
            Some(row) => roi_height as f64 - row as f64,
            None => 0.0,
        };
        let normalized = (bar_height / roi_height as f64) * 60.0;
        extracted_heights.push(normalized);
    }

    // Compare extracted vs computed
    let extracted_sum: f64 = extracted_heights.iter().sum();
    let computed_sum: f64 = values.iter().sum();

    if extracted_sum == 0.0 && computed_sum == 0.0 {
        return 1.0;
    }

    if extracted_sum == 0.0 || computed_sum == 0.0 {
        let max_possible = extracted_sum.max(computed_sum);
        return if max_possible > 30.0 { 0.1 } else { 0.3 };
    }

    // Normalize and compute MAE
    let ext_max = extracted_heights.iter().cloned().fold(0.0f64, f64::max) + 1e-10;
    let comp_max = values.iter().cloned().fold(0.0f64, f64::max) + 1e-10;

    let mut mae_sum = 0.0f64;
    for i in 0..NUM_SLICES {
        let ext_norm = extracted_heights[i] / ext_max;
        let comp_norm = values[i] / comp_max;
        mae_sum += (ext_norm - comp_norm).abs();
    }
    let mae = mae_sum / NUM_SLICES as f64;
    let mut score = 1.0 - mae;

    // Shift detection: check if bars are offset by ≥2 hours
    let ext_nonzero: Vec<usize> = extracted_heights
        .iter()
        .enumerate()
        .filter(|&(_, v)| *v / ext_max > 0.1)
        .map(|(i, _)| i)
        .collect();
    let comp_nonzero: Vec<usize> = values
        .iter()
        .enumerate()
        .filter(|&(_, v)| *v / comp_max > 0.1)
        .map(|(i, _)| i)
        .collect();

    if let (Some(&ext_first), Some(&comp_first)) = (ext_nonzero.first(), comp_nonzero.first()) {
        let start_diff = (ext_first as i32 - comp_first as i32).unsigned_abs() as usize;
        if start_diff >= 2 {
            let shift_penalty = (start_diff as f64 * 0.15).min(0.5);
            score = (score - shift_penalty).max(0.0);
        }
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slice_image_all_white() {
        // All white ROI → all values should be 0
        let img = RgbImage::from_fn(240, 100, |_, _| image::Rgb([255, 255, 255]));
        let result = slice_image(&img, 0, 0, 240, 100);
        assert_eq!(result.len(), 25);
        for &v in &result[..24] {
            assert!(v.abs() < 0.01, "Expected 0, got {v}");
        }
        assert!(result[24].abs() < 0.01);
    }

    #[test]
    fn test_slice_image_all_black() {
        // All black ROI → all values should be MAX_Y (60)
        let img = RgbImage::from_fn(240, 100, |_, _| image::Rgb([0, 0, 0]));
        let result = slice_image(&img, 0, 0, 240, 100);
        assert_eq!(result.len(), 25);
        for &v in &result[..24] {
            assert!((v - 60.0).abs() < 0.01, "Expected 60, got {v}");
        }
    }

    #[test]
    fn test_slice_image_returns_25_elements() {
        let img = RgbImage::new(480, 200);
        let result = slice_image(&img, 0, 0, 480, 200);
        assert_eq!(result.len(), 25); // 24 hours + total
    }

    #[test]
    fn test_alignment_score_identical() {
        // Both extracted and computed are zero → perfect score
        let roi = RgbImage::from_fn(240, 100, |_, _| image::Rgb([255, 255, 255]));
        let values = vec![0.0; 24];
        let score = compute_bar_alignment_score(&roi, &values);
        assert!((score - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_alignment_score_empty_roi() {
        let roi = RgbImage::new(0, 0);
        let score = compute_bar_alignment_score(&roi, &[0.0; 24]);
        assert!((score - 0.0).abs() < 0.01);
    }
}
