//! OCR text extraction and pattern matching.
//!
//! Port of Python ocr.py — regex patterns for digit normalization,
//! time extraction, and daily total page detection.

use lazy_static::lazy_static;
use regex::Regex;

// ---------------------------------------------------------------------------
// Pre-compiled regex patterns for OCR digit normalization
// ---------------------------------------------------------------------------

lazy_static! {
    // 1-like characters: I, l, |
    static ref RE_1_BEFORE_UNIT: Regex = Regex::new(r"([Il|])(\s*[hm]\b)").unwrap();
    static ref RE_1_AFTER_DIGIT: Regex = Regex::new(r"(\d)([Il|])(\s*[hms]\b)").unwrap();
    static ref RE_1_BEFORE_DIGIT: Regex = Regex::new(r"([Il|])(\d)").unwrap();

    // 0-like characters: O
    static ref RE_0_BEFORE_UNIT: Regex = Regex::new(r"([O])(\s*[hms]\b)").unwrap();
    static ref RE_0_AFTER_DIGIT: Regex = Regex::new(r"(\d)([O])(\s*[hms]\b)").unwrap();
    static ref RE_0_BEFORE_DIGIT: Regex = Regex::new(r"([O])(\d)").unwrap();
    static ref RE_0_BETWEEN_DIGITS: Regex = Regex::new(r"(\d)([O])(\d)").unwrap();

    // 4-like characters: A
    static ref RE_4_BEFORE_UNIT: Regex = Regex::new(r"([A])(\s*[hm]\b)").unwrap();
    static ref RE_4_AFTER_DIGIT: Regex = Regex::new(r"(\d)([A])(\s*[hms]\b)").unwrap();

    // 5-like characters: S
    static ref RE_5_BEFORE_UNIT: Regex = Regex::new(r"([S])(\s*[hm]\b)").unwrap();
    static ref RE_5_AFTER_DIGIT: Regex = Regex::new(r"(\d)([S])(\s*[hm]\b)").unwrap();
    static ref RE_5_BEFORE_DIGIT: Regex = Regex::new(r"([S])(\d)").unwrap();

    // 6-like characters: G, b
    static ref RE_6_BEFORE_UNIT: Regex = Regex::new(r"([Gb])(\s*[hms]\b)").unwrap();
    static ref RE_6_AFTER_DIGIT: Regex = Regex::new(r"(\d)([Gb])(\s*[hms]\b)").unwrap();

    // 8-like characters: B
    static ref RE_8_BEFORE_UNIT: Regex = Regex::new(r"([B])(\s*[hms]\b)").unwrap();
    static ref RE_8_AFTER_DIGIT: Regex = Regex::new(r"(\d)([B])(\s*[hms]\b)").unwrap();

    // 9-like characters: g, q
    static ref RE_9_BEFORE_UNIT: Regex = Regex::new(r"([gq])(\s*[hms]\b)").unwrap();
    static ref RE_9_AFTER_DIGIT: Regex = Regex::new(r"(\d)([gq])(\s*[hms]\b)").unwrap();

    // 2-like characters: Z
    static ref RE_2_BEFORE_UNIT: Regex = Regex::new(r"([Z])(\s*[hms]\b)").unwrap();
    static ref RE_2_AFTER_DIGIT: Regex = Regex::new(r"(\d)([Z])(\s*[hms]\b)").unwrap();

    // 7-like characters: T
    static ref RE_7_BEFORE_UNIT: Regex = Regex::new(r"([T])(\s*[hms]\b)").unwrap();
    static ref RE_7_AFTER_DIGIT: Regex = Regex::new(r"(\d)([T])(\s*[hms]\b)").unwrap();

    // Time extraction patterns
    static ref RE_HOUR_MIN: Regex = Regex::new(r"(\d{1,2})\s*h\s*(\d{1,2})\s*m").unwrap();
    // Note: Rust regex doesn't support lookahead. We match broadly and filter in code.
    static ref RE_HOUR_MIN_NO_M: Regex = Regex::new(r"(\d{1,2})\s*h\s+(\d{1,2})(\s*[hms])?").unwrap();
    static ref RE_MIN_SEC: Regex = Regex::new(r"(\d{1,2})\s*m\s*([0O]|\d{1,2})\s*s").unwrap();
    static ref RE_MIN_ONLY: Regex = Regex::new(r"(\d{1,2})\s*m\b").unwrap();
    static ref RE_HOURS_ONLY: Regex = Regex::new(r"(\d{1,2})\s*h\b").unwrap();
    static ref RE_SEC_ONLY: Regex = Regex::new(r"([0O]|\d{1,2})\s*s\b").unwrap();
    static ref RE_HAS_TIME: Regex = Regex::new(r"\d+\s*[hms]").unwrap();
}

/// Normalize common OCR misreadings of digits in time contexts.
///
/// Port of Python `_normalize_ocr_digits()`.
pub fn normalize_ocr_digits(text: &str) -> String {
    let mut result = text.to_string();

    // 1-like: I, l, |
    result = RE_1_BEFORE_UNIT.replace_all(&result, "1$2").to_string();
    result = RE_1_AFTER_DIGIT.replace_all(&result, "${1}1$3").to_string();
    result = RE_1_BEFORE_DIGIT.replace_all(&result, "1$2").to_string();

    // 0-like: O
    result = RE_0_BEFORE_UNIT.replace_all(&result, "0$2").to_string();
    result = RE_0_AFTER_DIGIT.replace_all(&result, "${1}0$3").to_string();
    result = RE_0_BEFORE_DIGIT.replace_all(&result, "0$2").to_string();
    result = RE_0_BETWEEN_DIGITS.replace_all(&result, "${1}0$3").to_string();

    // 4-like: A
    result = RE_4_BEFORE_UNIT.replace_all(&result, "4$2").to_string();
    result = RE_4_AFTER_DIGIT.replace_all(&result, "${1}4$3").to_string();

    // 5-like: S
    result = RE_5_BEFORE_UNIT.replace_all(&result, "5$2").to_string();
    result = RE_5_AFTER_DIGIT.replace_all(&result, "${1}5$3").to_string();
    result = RE_5_BEFORE_DIGIT.replace_all(&result, "5$2").to_string();

    // 6-like: G, b
    result = RE_6_BEFORE_UNIT.replace_all(&result, "6$2").to_string();
    result = RE_6_AFTER_DIGIT.replace_all(&result, "${1}6$3").to_string();

    // 8-like: B
    result = RE_8_BEFORE_UNIT.replace_all(&result, "8$2").to_string();
    result = RE_8_AFTER_DIGIT.replace_all(&result, "${1}8$3").to_string();

    // 9-like: g, q
    result = RE_9_BEFORE_UNIT.replace_all(&result, "9$2").to_string();
    result = RE_9_AFTER_DIGIT.replace_all(&result, "${1}9$3").to_string();

    // 2-like: Z
    result = RE_2_BEFORE_UNIT.replace_all(&result, "2$2").to_string();
    result = RE_2_AFTER_DIGIT.replace_all(&result, "${1}2$3").to_string();

    // 7-like: T
    result = RE_7_BEFORE_UNIT.replace_all(&result, "7$2").to_string();
    result = RE_7_AFTER_DIGIT.replace_all(&result, "${1}7$3").to_string();

    result
}

/// Extract a time duration value from text using regex patterns.
///
/// Port of Python `_extract_time_from_text()`.
pub fn extract_time_from_text(text: &str) -> String {
    // First normalize OCR errors
    let text = normalize_ocr_digits(text);

    // Try patterns in priority order

    // "Xh Ym"
    if let Some(caps) = RE_HOUR_MIN.captures(&text) {
        let h: u32 = caps[1].parse().unwrap_or(0);
        let m: u32 = caps[2].parse().unwrap_or(0);
        return format!("{h}h {m}m");
    }

    // "Xh Y" (missing m) — only match when NOT followed by h/m/s unit
    if let Some(caps) = RE_HOUR_MIN_NO_M.captures(&text) {
        // Group 3 captures an optional trailing unit. If absent, this is "Xh Y" without "m".
        if caps.get(3).is_none() {
            let h: u32 = caps[1].parse().unwrap_or(0);
            let m: u32 = caps[2].parse().unwrap_or(0);
            return format!("{h}h {m}m");
        }
    }

    // "Xm Ys"
    if let Some(caps) = RE_MIN_SEC.captures(&text) {
        let m: u32 = caps[1].parse().unwrap_or(0);
        let s_str = caps[2].replace('O', "0");
        let s: u32 = s_str.parse().unwrap_or(0);
        return format!("{m}m {s}s");
    }

    // "Xh"
    if let Some(caps) = RE_HOURS_ONLY.captures(&text) {
        let h: u32 = caps[1].parse().unwrap_or(0);
        return format!("{h}h");
    }

    // "Xm"
    if let Some(caps) = RE_MIN_ONLY.captures(&text) {
        let m: u32 = caps[1].parse().unwrap_or(0);
        return format!("{m}m");
    }

    // "Xs"
    if let Some(caps) = RE_SEC_ONLY.captures(&text) {
        let s_str = caps[1].replace('O', "0");
        let s: u32 = s_str.parse().unwrap_or(0);
        return format!("{s}s");
    }

    String::new()
}

/// Check if text contains any time pattern.
pub fn has_time_pattern(text: &str) -> bool {
    RE_HAS_TIME.is_match(text)
}

// ---------------------------------------------------------------------------
// Daily total page detection
// ---------------------------------------------------------------------------

/// Words indicating a daily total page (not app-specific).
const DAILY_PAGE_MARKERS: &[&str] = &[
    "WEEK",
    "DAY",
    "MOST",
    "USED",
    "CATEGORIES",
    "TODAY",
    "SHOW",
    "ENTERTAINMENT",
    "EDUCATION",
    "INFORMATION",
    "READING",
];

/// Words indicating an app-specific page.
const APP_PAGE_MARKERS: &[&str] = &[
    "INFO",
    "DEVELOPER",
    "RATING",
    "LIMIT",
    "AGE",
    "DAILY",
    "AVERAGE",
];

/// Determine if OCR text indicates a daily total page (vs app-specific).
///
/// Port of Python `is_daily_total_page()`.
pub fn is_daily_total_page(texts: &[String]) -> bool {
    let mut daily_count = 0;
    let mut app_count = 0;

    for text in texts {
        let upper = text.to_uppercase();

        for marker in DAILY_PAGE_MARKERS {
            if upper.contains(marker) {
                daily_count += 1;
                break;
            }
        }

        for marker in APP_PAGE_MARKERS {
            if upper.contains(marker) {
                app_count += 1;
                break;
            }
        }
    }

    daily_count > app_count
}

// ---------------------------------------------------------------------------
// OCR-based title and total extraction (requires leptess)
// ---------------------------------------------------------------------------

use image::RgbImage;
use log::info;

use crate::processing::image_utils::adjust_contrast_brightness;
use crate::processing::types::ProcessingError;

/// OCR bounding box from Tesseract (word-level).
/// Shared between ocr.rs and ocr_anchored.rs.
pub struct OcrWord {
    pub text: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Run Tesseract on an image and return word-level results.
///
/// Uses `set_image_from_mem` to avoid temp file I/O entirely.
pub fn run_tesseract(img: &RgbImage, psm: &str) -> Result<Vec<OcrWord>, ProcessingError> {
    // Encode image to PNG in memory
    let mut png_buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_buf);
    img.write_with_encoder(encoder)
        .map_err(|e| ProcessingError::Ocr(format!("PNG encode failed: {e}")))?;

    let mut lt = leptess::LepTess::new(None, "eng")
        .map_err(|e| ProcessingError::Ocr(format!("Tesseract init failed: {e}")))?;

    let _ = lt.set_variable(leptess::Variable::TesseditPagesegMode, psm);
    lt.set_image_from_mem(&png_buf)
        .map_err(|e| ProcessingError::Ocr(format!("Set image from mem failed: {e}")))?;
    lt.recognize();

    parse_tsv_words(&mut lt)
}

/// Parse TSV output from a recognized LepTess instance into word-level boxes.
pub fn parse_tsv_words(lt: &mut leptess::LepTess) -> Result<Vec<OcrWord>, ProcessingError> {
    let tsv = lt.get_tsv_text(0).unwrap_or_default();
    let mut words = Vec::new();

    for line in tsv.lines().skip(1) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 12 {
            let text = parts[11].trim().to_string();
            if text.is_empty() {
                continue;
            }
            words.push(OcrWord {
                text,
                x: parts[6].parse().unwrap_or(0),
                y: parts[7].parse().unwrap_or(0),
                w: parts[8].parse().unwrap_or(0),
                h: parts[9].parse().unwrap_or(0),
            });
        }
    }

    Ok(words)
}

/// Extract the screenshot title using pre-computed full-image OCR data.
fn extract_title(
    img: &RgbImage,
    ocr_data: &[OcrWord],
) -> Result<(String, Option<i32>), ProcessingError> {
    // Check if daily total page
    let texts: Vec<String> = ocr_data.iter().map(|w| w.text.clone()).collect();
    if is_daily_total_page(&texts) {
        return Ok(("Daily Total".to_string(), None));
    }

    // Find "INFO" text position
    let info_word = ocr_data.iter().find(|w| w.text.contains("INFO"));

    if let Some(info) = info_word {
        let app_height = (info.h * 7) as u32;
        let title_y = (info.y + info.h) as u32;
        let x_origin = (info.x as f64 + 1.5 * info.w as f64) as u32;
        let x_width = (info.w * 12) as u32;

        let (img_w, img_h) = img.dimensions();
        let x_end = (x_origin + x_width).min(img_w);
        let y_end = (title_y + app_height).min(img_h);

        if x_end > x_origin && y_end > title_y {
            let region = image::imageops::crop_imm(img, x_origin, title_y, x_end - x_origin, y_end - title_y).to_image();
            let region_enhanced = adjust_contrast_brightness(&region, 2.0, 0);
            let words = run_tesseract(&region_enhanced, "3")?;

            let mut title = String::new();
            for w in &words {
                if !w.text.is_empty() {
                    if !title.is_empty() {
                        title.push(' ');
                    }
                    title.push_str(&w.text.replace('|', ""));
                }
            }

            let title = title.trim().trim_matches(|c| c == '#' || c == '_' || c == ' ').to_string();

            if title.len() > 50 {
                info!("Title too long ({} chars), likely OCR garbage", title.len());
                return Ok((String::new(), Some(y_end as i32)));
            }

            info!("Found title: '{}' at y={}", title, y_end);
            return Ok((title, Some(y_end as i32)));
        }
    }

    Ok((String::new(), None))
}

/// Extract total screen time using pre-computed full-image OCR data.
fn extract_total(
    img: &RgbImage,
    ocr_data: &[OcrWord],
) -> Result<String, ProcessingError> {
    let texts: Vec<String> = ocr_data.iter().map(|w| w.text.clone()).collect();
    let is_daily = is_daily_total_page(&texts);

    let screen_word = ocr_data.iter().find(|w| w.text.contains("SCREEN"));

    if let Some(screen) = screen_word {
        let (img_w, img_h) = img.dimensions();

        let (x_origin, y_origin, width, height) = if is_daily {
            let y = (screen.y + screen.h + 95) as u32;
            let h = (screen.h * 5) as u32;
            let x = (screen.x - 50).max(0) as u32;
            let w = (screen.w * 4) as u32;
            (x, y, w, h)
        } else {
            let h = (screen.h * 6) as u32;
            let y = (screen.y + screen.h + 50) as u32;
            let x = (screen.x - 20).max(0) as u32;
            let max_w = img_w / 3;
            let w = ((screen.w * 3) as u32).min(max_w);
            (x, y, w, h)
        };

        let x_end = (x_origin + width).min(img_w);
        let y_end = (y_origin + height).min(img_h);

        if x_end > x_origin && y_end > y_origin {
            let region = image::imageops::crop_imm(img, x_origin, y_origin, x_end - x_origin, y_end - y_origin).to_image();
            let words = run_tesseract(&region, "3")?;

            let mut total_text = String::new();
            for w in &words {
                let piece = w.text.replace("Os", "0s").replace('|', "");
                if !piece.is_empty() {
                    if !total_text.is_empty() {
                        total_text.push(' ');
                    }
                    total_text.push_str(&piece);
                }
            }

            let total_text = normalize_ocr_digits(total_text.trim());
            let extracted = extract_time_from_text(&total_text);

            if !extracted.is_empty() {
                info!("Found total: '{}' (from '{}')", extracted, total_text);
                return Ok(extracted);
            }
        }
    }

    // Fallback: try extracting time from the already-cached full-image OCR text
    // This avoids running Tesseract again on the left-third/left-half
    let full_text: String = ocr_data.iter()
        .map(|w| w.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .replace("Os", "0s");
    let total = extract_time_from_text(&full_text);
    if !total.is_empty() {
        info!("Found total via full-image text fallback: '{}'", total);
        return Ok(total);
    }

    Ok(String::new())
}

/// Extract both title and total from an image with a SINGLE Tesseract call.
///
/// Runs full-image OCR once and shares the result for both title and total extraction.
/// Errors are propagated, not silently swallowed.
pub fn find_title_and_total(
    img: &RgbImage,
) -> Result<(String, Option<i32>, String), ProcessingError> {
    // Run Tesseract ONCE on the full image
    let ocr_data = run_tesseract(img, "3")?;

    // Extract title and total using the cached OCR data
    let (title, title_y) = extract_title(img, &ocr_data)?;
    let total = extract_total(img, &ocr_data)?;

    Ok((title, title_y, total))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- normalize_ocr_digits ---

    #[test]
    fn test_normalize_i_to_1() {
        assert_eq!(normalize_ocr_digits("I h"), "1 h");
        assert_eq!(normalize_ocr_digits("3I h"), "31 h");
        assert_eq!(normalize_ocr_digits("I2"), "12");
    }

    #[test]
    fn test_normalize_o_to_0() {
        assert_eq!(normalize_ocr_digits("O h"), "0 h");
        assert_eq!(normalize_ocr_digits("1O h"), "10 h");
        assert_eq!(normalize_ocr_digits("O5"), "05");
        assert_eq!(normalize_ocr_digits("1O2"), "102");
    }

    #[test]
    fn test_normalize_s_to_5() {
        assert_eq!(normalize_ocr_digits("S h"), "5 h");
        assert_eq!(normalize_ocr_digits("3S h"), "35 h");
    }

    #[test]
    fn test_normalize_a_to_4() {
        assert_eq!(normalize_ocr_digits("A h"), "4 h");
        assert_eq!(normalize_ocr_digits("1A h"), "14 h");
    }

    #[test]
    fn test_normalize_preserves_normal_text() {
        assert_eq!(normalize_ocr_digits("hello world"), "hello world");
        assert_eq!(normalize_ocr_digits("3h 45m"), "3h 45m");
    }

    // --- extract_time_from_text ---

    #[test]
    fn test_extract_hour_min() {
        assert_eq!(extract_time_from_text("4h 36m"), "4h 36m");
        assert_eq!(extract_time_from_text("12h 5m"), "12h 5m");
        assert_eq!(extract_time_from_text("some text 2h 30m more text"), "2h 30m");
    }

    #[test]
    fn test_extract_hour_min_no_m() {
        assert_eq!(extract_time_from_text("4h 36"), "4h 36m");
    }

    #[test]
    fn test_extract_min_sec() {
        assert_eq!(extract_time_from_text("45m 30s"), "45m 30s");
        assert_eq!(extract_time_from_text("5m Os"), "5m 0s");
    }

    #[test]
    fn test_extract_hours_only() {
        assert_eq!(extract_time_from_text("3h"), "3h");
    }

    #[test]
    fn test_extract_min_only() {
        assert_eq!(extract_time_from_text("45m"), "45m");
    }

    #[test]
    fn test_extract_sec_only() {
        assert_eq!(extract_time_from_text("30s"), "30s");
    }

    #[test]
    fn test_extract_no_time() {
        assert_eq!(extract_time_from_text("no time here"), "");
        assert_eq!(extract_time_from_text(""), "");
    }

    #[test]
    fn test_extract_with_ocr_errors() {
        // I should become 1, O should become 0
        assert_eq!(extract_time_from_text("Ih 3Om"), "1h 30m");
    }

    // --- is_daily_total_page ---

    #[test]
    fn test_daily_total_page() {
        let texts: Vec<String> = vec![
            "SCREEN".to_string(),
            "TIME".to_string(),
            "MOST".to_string(),
            "USED".to_string(),
            "TODAY".to_string(),
            "CATEGORIES".to_string(),
        ];
        assert!(is_daily_total_page(&texts));
    }

    #[test]
    fn test_app_usage_page() {
        let texts: Vec<String> = vec![
            "Instagram".to_string(),
            "INFO".to_string(),
            "DEVELOPER".to_string(),
            "RATING".to_string(),
            "LIMIT".to_string(),
        ];
        assert!(!is_daily_total_page(&texts));
    }

    #[test]
    fn test_has_time_pattern() {
        assert!(has_time_pattern("4h 36m"));
        assert!(has_time_pattern("45m"));
        assert!(has_time_pattern("30s"));
        assert!(!has_time_pattern("hello world"));
    }
}
