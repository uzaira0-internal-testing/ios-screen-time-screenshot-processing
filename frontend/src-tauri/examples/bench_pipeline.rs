//! Quick benchmark: run the Rust processing pipeline on real images.
//! Usage: cargo run --release --example bench_pipeline -- /path/to/images/

use std::env;
use std::fs;
use std::time::Instant;

fn main() {
    let args: Vec<String> = env::args().collect();
    let dir = args.get(1).map(|s| s.as_str()).unwrap_or("/tmp/test-images");

    let entries: Vec<_> = fs::read_dir(dir)
        .expect("Failed to read directory")
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "png" || ext == "jpg" || ext == "jpeg")
                .unwrap_or(false)
        })
        .collect();

    println!("Processing {} images from {dir}", entries.len());
    println!("{:<40} {:>10} {:>10} {:>8} {:>8}", "Image", "Method", "Time(ms)", "Total", "Score");
    println!("{}", "-".repeat(80));

    let mut total_time_ms = 0u64;
    let mut processed = 0u32;

    for entry in &entries {
        let path = entry.path();
        let name = path.file_name().unwrap().to_string_lossy();

        let start = Instant::now();
        let img = image::open(&path);
        let img = match img {
            Ok(i) => i.to_rgb8(),
            Err(e) => {
                println!("{name:<40} ERROR: {e}");
                continue;
            }
        };

        let (w, h) = img.dimensions();

        // Try line-based detection
        let mut work_img = img.clone();
        ios_screen_time::processing::image_utils::convert_dark_mode(&mut work_img);

        let grid_start = Instant::now();
        let grid_result = ios_screen_time::processing::grid_detection::line_based::detect(&work_img);
        let grid_ms = grid_start.elapsed().as_millis();

        match grid_result {
            Ok(ref r) if r.success => {
                let bounds = r.bounds.unwrap();
                let slice_start = Instant::now();
                let row = ios_screen_time::processing::bar_extraction::slice_image(
                    &work_img,
                    bounds.roi_x() as u32,
                    bounds.roi_y() as u32,
                    bounds.width() as u32,
                    bounds.height() as u32,
                );
                let slice_ms = slice_start.elapsed().as_millis();

                let total: f64 = row[..24].iter().sum();
                let elapsed = start.elapsed().as_millis() as u64;
                total_time_ms += elapsed;
                processed += 1;

                // Compute alignment score
                let roi = image::imageops::crop_imm(
                    &work_img,
                    bounds.roi_x() as u32,
                    bounds.roi_y() as u32,
                    bounds.width() as u32,
                    bounds.height() as u32,
                ).to_image();
                let score = ios_screen_time::processing::bar_extraction::compute_bar_alignment_score(
                    &roi, &row[..24],
                );

                println!(
                    "{name:<40} {res:<10} {elapsed:>7}ms {total:>8.1} {score:>7.2}",
                    res = format!("{w}x{h}"),
                );
                println!(
                    "  grid={grid_ms}ms slice={slice_ms}ms bounds=({},{} {}x{})",
                    bounds.roi_x(), bounds.roi_y(), bounds.width(), bounds.height()
                );

                // Print hourly values
                let vals: Vec<String> = row[..24].iter().map(|v| format!("{v:.1}")).collect();
                println!("  hours: [{}]", vals.join(", "));
            }
            Ok(ref r) => {
                let elapsed = start.elapsed().as_millis();
                println!(
                    "{name:<40} {res:<10} {elapsed:>7}ms GRID_FAIL: {}",
                    r.error.as_deref().unwrap_or("unknown"),
                    res = format!("{w}x{h}"),
                );
            }
            Err(e) => {
                let elapsed = start.elapsed().as_millis();
                println!("{name:<40} {res:<10} {elapsed:>7}ms ERROR: {e}", res = format!("{w}x{h}"));
            }
        }
    }

    println!("{}", "-".repeat(80));
    if processed > 0 {
        println!(
            "Processed {processed}/{} images. Total: {total_time_ms}ms, Avg: {}ms/image",
            entries.len(),
            total_time_ms / processed as u64,
        );
    } else {
        println!("No images processed successfully.");
    }
}
