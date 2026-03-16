//! Criterion benchmarks for the Rust image processing pipeline.
//!
//! Metrics:
//! - pipeline_us: Full process_image on a test image
//! - slice_us: slice_image on a known ROI
//! - grid_us: line_based::detect on a known-resolution screenshot

use criterion::{criterion_group, criterion_main, Criterion};
use image::RgbImage;
use std::path::Path;

fn load_test_image() -> Option<RgbImage> {
    let paths = [
        "/tmp/test-images/test1.png",
        "/tmp/test-images/test2.png",
    ];
    for p in &paths {
        if Path::new(p).exists() {
            if let Ok(img) = image::open(p) {
                return Some(img.to_rgb8());
            }
        }
    }
    // Generate a synthetic 896x2048 image with grid-like features
    Some(generate_synthetic_screenshot())
}

/// Generate a synthetic screenshot that mimics an iOS Screen Time screenshot
/// at 896x2048 resolution with horizontal grid lines and bar patterns.
fn generate_synthetic_screenshot() -> RgbImage {
    let w = 896u32;
    let h = 2048u32;
    let mut img = RgbImage::from_fn(w, h, |_, _| image::Rgb([255, 255, 255]));

    // Draw horizontal grid lines at known positions (simulating the chart)
    let grid_y_positions = [673, 718, 763, 808, 853];
    let grid_x_start = 73u32;
    let grid_x_end = 763u32;

    for &y in &grid_y_positions {
        for x in grid_x_start..grid_x_end {
            if y < h && x < w {
                img.put_pixel(x, y, image::Rgb([200, 200, 200])); // gray grid line
            }
        }
    }

    // Draw vertical dotted lines (4 lines at 6h intervals)
    let section_width = (grid_x_end - grid_x_start) / 4;
    for i in 1..4 {
        let x = grid_x_start + i * section_width;
        for y in 673..853 {
            if y % 3 != 0 { // dotted pattern
                img.put_pixel(x, y, image::Rgb([200, 200, 200]));
            }
        }
    }

    // Draw some bars (black pixels in the chart area)
    let bar_height = 50u32;
    let slice_width = (grid_x_end - grid_x_start) / 24;
    for hour in [8, 12, 18] {
        let bar_x = grid_x_start + hour * slice_width + slice_width / 4;
        let bar_x_end = bar_x + slice_width / 2;
        for x in bar_x..bar_x_end.min(w) {
            for y in (853 - bar_height)..853 {
                if y < h {
                    img.put_pixel(x, y, image::Rgb([0, 0, 0]));
                }
            }
        }
    }

    img
}

fn bench_grid_detection(c: &mut Criterion) {
    let img = load_test_image().expect("Need a test image");
    let mut work = img.clone();
    ios_screen_time::processing::image_utils::convert_dark_mode(&mut work);

    c.bench_function("grid_detect_line_based", |b| {
        b.iter(|| {
            let _ = ios_screen_time::processing::grid_detection::line_based::detect(&work);
        })
    });
}

fn bench_slice_image(c: &mut Criterion) {
    let img = load_test_image().expect("Need a test image");
    let mut work = img.clone();
    ios_screen_time::processing::image_utils::convert_dark_mode(&mut work);

    // Use known bounds for 896x2048
    let roi_x = 73u32;
    let roi_y = 673u32;
    let roi_w = 690u32;
    let roi_h = 180u32;

    c.bench_function("slice_image_24h", |b| {
        b.iter(|| {
            let _ = ios_screen_time::processing::bar_extraction::slice_image(
                &work, roi_x, roi_y, roi_w, roi_h,
            );
        })
    });
}

fn bench_full_pipeline(c: &mut Criterion) {
    let img = load_test_image().expect("Need a test image");

    c.bench_function("full_pipeline", |b| {
        b.iter(|| {
            let mut work = img.clone();
            ios_screen_time::processing::image_utils::convert_dark_mode(&mut work);

            let grid_result = ios_screen_time::processing::grid_detection::line_based::detect(&work);
            if let Ok(ref r) = grid_result {
                if r.success {
                    let bounds = r.bounds.unwrap();
                    let _ = ios_screen_time::processing::bar_extraction::slice_image(
                        &work,
                        bounds.roi_x() as u32,
                        bounds.roi_y() as u32,
                        bounds.width() as u32,
                        bounds.height() as u32,
                    );
                }
            }
        })
    });
}

fn bench_image_utils(c: &mut Criterion) {
    let img = load_test_image().expect("Need a test image");

    c.bench_function("darken_non_white", |b| {
        b.iter(|| {
            let mut work = img.clone();
            ios_screen_time::processing::image_utils::darken_non_white(&mut work);
        })
    });

    c.bench_function("reduce_color_count_2", |b| {
        b.iter(|| {
            let mut work = img.clone();
            ios_screen_time::processing::image_utils::reduce_color_count(&mut work, 2);
        })
    });

    c.bench_function("convert_dark_mode", |b| {
        b.iter(|| {
            let mut work = img.clone();
            ios_screen_time::processing::image_utils::convert_dark_mode(&mut work);
        })
    });
}

criterion_group!(
    benches,
    bench_grid_detection,
    bench_slice_image,
    bench_full_pipeline,
    bench_image_utils,
);
criterion_main!(benches);
