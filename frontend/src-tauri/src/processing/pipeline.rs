//! Full image processing pipeline orchestration.
//!
//! Port of Python image_processor.py — ties together all processing stages:
//! dark mode conversion, grid detection, bar extraction, OCR, and alignment scoring.

use std::path::Path;
use std::time::Instant;

use image::RgbImage;
use log::info;

use super::bar_extraction::{compute_bar_alignment_score, slice_image};
use super::grid_detection;
use super::image_utils::{convert_dark_mode, remove_all_but};
use super::ocr;
use super::types::{
    DetectionMethod, GridBounds, ImageType, ProcessingError, ProcessingResult,
};

/// Load an image from disk and convert to RGB.
fn load_image(path: &str) -> Result<RgbImage, ProcessingError> {
    let img = image::open(path)?;
    Ok(img.to_rgb8())
}

/// Load image and apply dark mode conversion.
fn load_and_prepare(path: &str) -> Result<RgbImage, ProcessingError> {
    let mut img = load_image(path)?;
    convert_dark_mode(&mut img);
    Ok(img)
}

/// Extract bar values and compute alignment score for given bounds.
/// Returns (hourly_values_24, total, alignment_score).
fn extract_and_score(
    img: &RgbImage,
    bounds: &GridBounds,
    image_type: ImageType,
) -> (Vec<f64>, f64, f64) {
    let roi_x = bounds.roi_x() as u32;
    let roi_y = bounds.roi_y() as u32;
    let roi_w = bounds.width() as u32;
    let roi_h = bounds.height() as u32;

    // For battery images, apply color isolation to a copy of the ROI only (not full image)
    let hourly_row = if image_type == ImageType::Battery {
        let mut roi = image::imageops::crop_imm(img, roi_x, roi_y, roi_w, roi_h).to_image();
        // Battery color in BGR [255, 121, 0] → RGB [0, 121, 255]
        remove_all_but(&mut roi, [0, 121, 255], 30);
        slice_image(&roi, 0, 0, roi_w, roi_h)
    } else {
        slice_image(img, roi_x, roi_y, roi_w, roi_h)
    };

    // Ensure we have at least 24 values (slice_image returns 25: 24 hours + total)
    let hourly_values = if hourly_row.len() > 24 {
        hourly_row[..24].to_vec()
    } else {
        let mut v = hourly_row.clone();
        v.resize(24, 0.0);
        v
    };

    let total: f64 = hourly_values.iter().sum();

    // Compute alignment score using original (non-binarized) ROI
    let roi_original = image::imageops::crop_imm(img, roi_x, roi_y, roi_w, roi_h).to_image();
    let alignment_score = compute_bar_alignment_score(&roi_original, &hourly_values);

    (hourly_values, total, alignment_score)
}

/// Process a screenshot with automatic grid detection.
pub fn process_image(
    path: &str,
    image_type: ImageType,
    detection_method: DetectionMethod,
) -> Result<ProcessingResult, ProcessingError> {
    let start = Instant::now();
    let img = load_and_prepare(path)?;

    // Detect grid bounds (image is already dark-mode converted)
    let grid_result = grid_detection::detect_grid(&img, detection_method)?;

    let bounds = match (grid_result.success, grid_result.bounds) {
        (true, Some(b)) => b,
        _ => {
            return Err(ProcessingError::GridDetection(
                grid_result.error.unwrap_or_else(|| "Grid detection failed".to_string()),
            ));
        }
    };

    let (hourly_values, total, alignment_score) = extract_and_score(&img, &bounds, image_type);

    // Extract title and total via OCR
    let (title, _title_y, total_text) = ocr::find_title_and_total(&img)?;

    let elapsed = start.elapsed().as_millis() as u64;
    info!(
        "Processed {} in {elapsed}ms (method={}, title='{}', total_text='{}', alignment={alignment_score:.2})",
        Path::new(path).file_name().unwrap_or_default().to_string_lossy(),
        grid_result.method,
        title,
        total_text,
    );

    Ok(ProcessingResult {
        hourly_values,
        total,
        title: if title.is_empty() { None } else { Some(title) },
        total_text: if total_text.is_empty() { None } else { Some(total_text) },
        grid_bounds: Some(bounds),
        alignment_score,
        detection_method: grid_result.method,
        processing_time_ms: elapsed,
    })
}

/// Process a screenshot with user-provided grid coordinates.
pub fn process_image_with_grid(
    path: &str,
    upper_left: [i32; 2],
    lower_right: [i32; 2],
    image_type: ImageType,
) -> Result<ProcessingResult, ProcessingError> {
    let start = Instant::now();
    let img = load_and_prepare(path)?;
    let (w, h) = img.dimensions();

    let bounds = grid_detection::calculate_roi_from_clicks(upper_left, lower_right, w, h)?;
    let (hourly_values, total, alignment_score) = extract_and_score(&img, &bounds, image_type);

    let (title, _title_y, total_text) = ocr::find_title_and_total(&img)?;

    Ok(ProcessingResult {
        hourly_values,
        total,
        title: if title.is_empty() { None } else { Some(title) },
        total_text: if total_text.is_empty() { None } else { Some(total_text) },
        grid_bounds: Some(bounds),
        alignment_score,
        detection_method: "manual".to_string(),
        processing_time_ms: start.elapsed().as_millis() as u64,
    })
}

/// Extract only hourly data (skip OCR, fast path).
pub fn extract_hourly_data(
    path: &str,
    upper_left: [i32; 2],
    lower_right: [i32; 2],
    image_type: ImageType,
) -> Result<Vec<f64>, ProcessingError> {
    let img = load_and_prepare(path)?;
    let (w, h) = img.dimensions();
    let bounds = grid_detection::calculate_roi_from_clicks(upper_left, lower_right, w, h)?;

    let hourly_row = if image_type == ImageType::Battery {
        let roi_x = bounds.roi_x() as u32;
        let roi_y = bounds.roi_y() as u32;
        let roi_w = bounds.width() as u32;
        let roi_h = bounds.height() as u32;
        let mut roi = image::imageops::crop_imm(&img, roi_x, roi_y, roi_w, roi_h).to_image();
        remove_all_but(&mut roi, [0, 121, 255], 30);
        slice_image(&roi, 0, 0, roi_w, roi_h)
    } else {
        slice_image(
            &img,
            bounds.roi_x() as u32,
            bounds.roi_y() as u32,
            bounds.width() as u32,
            bounds.height() as u32,
        )
    };

    Ok(hourly_row)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_and_score_white_image() {
        let img = RgbImage::from_fn(240, 100, |_, _| image::Rgb([255, 255, 255]));
        let bounds = GridBounds::from_roi(0, 0, 240, 100);
        let (values, total, _score) = extract_and_score(&img, &bounds, ImageType::ScreenTime);
        assert_eq!(values.len(), 24);
        assert!(total.abs() < 0.01);
    }
}
