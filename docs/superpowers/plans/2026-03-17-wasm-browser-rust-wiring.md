# WASM Browser Rust Wiring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile the shared `crates/processing` Rust library to WebAssembly and use it in the browser worker for bar extraction and line-based grid detection, replacing the Canvas JS port implementations.

**Architecture:** Create a new `crates/wasm-bindings` crate that depends on `crates/processing` with a `no-ocr` feature flag (since `leptess` C bindings cannot compile to `wasm32-unknown-unknown`). This crate uses `wasm-bindgen` to expose `slice_image_bytes` and `detect_grid_line_based_bytes`. Build with `wasm-pack` to produce a JS/WASM module placed at `frontend/public/wasm/`. The browser worker (`imageProcessor.worker.canvas.ts`) loads this module at init and calls it instead of the Canvas JS implementations for the two hot paths. Tesseract.js is kept for OCR (title, total, OCR-anchored grid detection) since Tesseract itself runs as WASM already.

**Tech Stack:** Rust, wasm-pack, wasm-bindgen, TypeScript Web Worker, `image` crate (WASM-safe)

---

## What Changes and Why

| Component | Before | After |
|---|---|---|
| Bar extraction in browser | Canvas JS port (~50-200ms) | Rust WASM (~2-10ms) |
| Line-based grid detection in browser | Canvas JS port (~30-100ms) | Rust WASM (~5-20ms) |
| OCR in browser | Tesseract.js (unchanged) | Tesseract.js (unchanged) |
| OCR-anchored grid detection | Canvas JS port using Tesseract | Unchanged (OCR still needed) |

Tauri is untouched — it already uses the native Rust crate directly.

---

## Constraint: leptess Cannot Compile to WASM

`leptess = "0.14"` is a C binding (Tesseract via FFI). It links against system libraries (`libtesseract`, `libleptonica`) which are not available in `wasm32-unknown-unknown`. We must feature-gate all `leptess` usage so the crate can build without it.

**Feature flag strategy:**
- `crates/processing`: Add `[features] default = ["ocr"]` where `ocr` enables `leptess`
- `crates/wasm-bindings`: Depend on `ios-screen-time-image-pipeline` with `default-features = false` (no leptess)
- Functions gated by `#[cfg(feature = "ocr")]` return errors/None when disabled

**Files with leptess usage that need gating:**
- `crates/processing/src/ocr.rs` — directly uses `leptess::LepTess`
- `crates/processing/src/grid_detection/ocr_anchored.rs` — calls `ocr::run_tesseract()`
- `crates/processing/src/pipeline.rs` — calls `ocr::find_title_and_total()`

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `crates/processing/Cargo.toml` | Make `leptess` optional via `ocr` feature |
| Modify | `crates/processing/src/ocr.rs` | Gate leptess code behind `#[cfg(feature = "ocr")]` |
| Modify | `crates/processing/src/grid_detection/ocr_anchored.rs` | Gate `run_tesseract` calls behind `#[cfg(feature = "ocr")]` |
| Modify | `crates/processing/src/pipeline.rs` | Gate OCR calls behind `#[cfg(feature = "ocr")]` |
| Modify | `Cargo.toml` (workspace root) | Add `crates/wasm-bindings` to workspace members |
| Create | `crates/wasm-bindings/Cargo.toml` | New wasm-bindgen crate |
| Create | `crates/wasm-bindings/src/lib.rs` | WASM-exported functions |
| Create | `scripts/build-wasm.sh` | Build script for wasm-pack |
| Create | `frontend/src/core/implementations/wasm/processing/screenshotProcessorWasm.ts` | TS wrapper + lazy init |
| Modify | `frontend/src/core/implementations/wasm/processing/workers/imageProcessor.worker.canvas.ts` | Use WASM for bar extraction and line-based grid detection |

---

### Task 1: Make `leptess` optional in `crates/processing`

**Files:**
- Modify: `crates/processing/Cargo.toml`
- Modify: `crates/processing/src/ocr.rs`
- Modify: `crates/processing/src/grid_detection/ocr_anchored.rs`
- Modify: `crates/processing/src/pipeline.rs`

- [ ] **Step 1: Update `crates/processing/Cargo.toml`**

Change `leptess` from a hard dependency to an optional one:

```toml
[package]
name = "ios-screen-time-image-pipeline"
version = "0.5.2"
edition = "2021"
description = "Bar graph extraction, grid detection, and OCR for iOS Screen Time screenshots"

[features]
default = ["ocr"]
ocr = ["dep:leptess"]

[dependencies]
image = "0.25"
regex = "1"
lazy_static = "1"
thiserror = "2"
log = "0.4"
leptess = { version = "0.14", optional = true }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Verify the existing build still works with default features**

```bash
cd /home/opt/ios-screen-time-screenshot-processing
cargo build -p ios-screen-time-image-pipeline
```

Expected: builds successfully (leptess still compiled via `default = ["ocr"]`)

- [ ] **Step 3: Gate leptess usage in `crates/processing/src/ocr.rs`**

Wrap all leptess-dependent code. The file currently has functions like `run_tesseract()` and `find_title_and_total()`. Identify which functions depend on leptess and wrap them:

```rust
// At the top of ocr.rs, wrap leptess-specific code:
#[cfg(feature = "ocr")]
use leptess;

// For each function that uses leptess, add #[cfg(feature = "ocr")]:
#[cfg(feature = "ocr")]
pub fn run_tesseract(img: &image::RgbImage, psm: &str) -> Result<Vec<OcrWord>, ProcessingError> {
    // ... existing leptess code unchanged ...
}

// Provide a stub when OCR feature is disabled:
#[cfg(not(feature = "ocr"))]
pub fn run_tesseract(_img: &image::RgbImage, _psm: &str) -> Result<Vec<OcrWord>, ProcessingError> {
    Err(ProcessingError::Ocr("OCR not available (compiled without 'ocr' feature)".to_string()))
}

#[cfg(feature = "ocr")]
pub fn find_title_and_total(img: &image::RgbImage) -> Result<(Option<String>, Option<i32>, Option<String>), ProcessingError> {
    // ... existing code unchanged ...
}

#[cfg(not(feature = "ocr"))]
pub fn find_title_and_total(_img: &image::RgbImage) -> Result<(Option<String>, Option<i32>, Option<String>), ProcessingError> {
    Ok((None, None, None))
}
```

Also gate `parse_tsv_words` (it takes `&mut leptess::LepTess`) behind `#[cfg(feature = "ocr")]` — no stub needed since it's only called from `run_tesseract`.

Note: `extract_time_from_text` and `normalize_ocr_digits` are pure string operations with no leptess dependency — leave them ungated.

- [ ] **Step 4: Gate `run_tesseract` calls in `crates/processing/src/grid_detection/ocr_anchored.rs`**

`ocr_anchored.rs` calls `ocr::run_tesseract()`. Gate the whole detection function:

```rust
#[cfg(feature = "ocr")]
pub fn detect_grid_ocr_anchored(img: &image::RgbImage) -> Result<DetectionResult, ProcessingError> {
    // ... existing code unchanged ...
}

#[cfg(not(feature = "ocr"))]
pub fn detect_grid_ocr_anchored(_img: &image::RgbImage) -> Result<DetectionResult, ProcessingError> {
    Ok(DetectionResult { success: false, bounds: None, ..Default::default() })
}
```

Also gate the `use crate::ocr::{run_tesseract, OcrWord};` import behind `#[cfg(feature = "ocr")]`.

- [ ] **Step 5: Gate OCR calls in `crates/processing/src/pipeline.rs`**

In `process_image()` and `process_image_with_grid()`, the OCR call `ocr::find_title_and_total(&img)?` must be guarded:

```rust
// In process_image() and process_image_with_grid():
let (title, _title_y, total_text) = {
    #[cfg(feature = "ocr")]
    { ocr::find_title_and_total(&img)? }
    #[cfg(not(feature = "ocr"))]
    { (None, None, None) }
};
```

- [ ] **Step 6: Verify no-OCR build succeeds**

```bash
cargo check --target wasm32-unknown-unknown -p ios-screen-time-image-pipeline --no-default-features
```

Expected: exits with code 0 (no errors). This verifies the feature-gating is correct for the WASM target without needing wasm-pack installed yet.

- [ ] **Step 7: Verify default build still passes tests**

```bash
cargo test -p ios-screen-time-image-pipeline
```

Expected: all tests PASS

- [ ] **Step 8: Verify Tauri still builds (it uses default features)**

```bash
cargo build -p screenshot-processor-tauri
```

Expected: builds successfully

- [ ] **Step 9: Verify PyO3 extension still builds**

```bash
cd rust-python && maturin build --release --interpreter python3.12
```

Expected: builds successfully

- [ ] **Step 10: Commit**

```bash
git add crates/processing/Cargo.toml crates/processing/src/ocr.rs \
        crates/processing/src/grid_detection/ocr_anchored.rs \
        crates/processing/src/pipeline.rs
git commit -m "feat: make leptess optional via 'ocr' feature flag in processing crate"
```

---

### Task 2: Create `crates/wasm-bindings`

**Files:**
- Modify: `Cargo.toml` (workspace root)
- Create: `crates/wasm-bindings/Cargo.toml`
- Create: `crates/wasm-bindings/src/lib.rs`

This crate exposes two WASM-safe functions:
1. `slice_image_bytes(image_bytes, roi_x, roi_y, roi_width, roi_height) -> Float64Array`
2. `detect_grid_line_based_bytes(image_bytes) -> JsValue` (serialized GridBounds or null)

**Pre-check:** `bar_extraction::slice_image` is already `pub fn` (confirmed in `crates/processing/src/bar_extraction.rs:22`). No visibility change needed.

- [ ] **Step 1: Add `crates/wasm-bindings` to workspace `Cargo.toml`**

```toml
[workspace]
members = [
    "crates/processing",
    "crates/wasm-bindings",     # ← add this line
    "frontend/src-tauri",
    "rust-python",
]
```

- [ ] **Step 2: Create `crates/wasm-bindings/Cargo.toml`**

```toml
[package]
name = "screenshot-processor-wasm"
version = "0.1.0"
edition = "2021"
description = "WebAssembly bindings for iOS Screen Time screenshot processing"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
ios-screen-time-image-pipeline = { path = "../processing", default-features = false }

[package.metadata.wasm-pack.profile.release]
wasm-opt = ["-O3", "--enable-simd"]
```

- [ ] **Step 3: Create `crates/wasm-bindings/src/lib.rs`**

```rust
//! WebAssembly bindings for iOS Screen Time screenshot processing.
//!
//! Exposes bar extraction and line-based grid detection without requiring
//! leptess (Tesseract C bindings), making these functions WASM-safe.
//!
//! OCR (title/total extraction) is intentionally excluded — the browser
//! uses Tesseract.js for that.

use wasm_bindgen::prelude::*;
use ios_screen_time_image_pipeline as processing;
use processing::types::DetectionMethod;

/// Extract 24 hourly bar values from an image region.
///
/// Args:
///     image_bytes: Raw PNG or JPEG bytes
///     roi_x: Left edge of the graph region (pixels)
///     roi_y: Top edge of the graph region (pixels)
///     roi_width: Width of the graph region (pixels)
///     roi_height: Height of the graph region (pixels)
///
/// Returns:
///     Float64Array of 24 values (minutes per hour, 0.0–60.0),
///     or throws on image decode failure.
#[wasm_bindgen]
pub fn slice_image_bytes(
    image_bytes: &[u8],
    roi_x: u32,
    roi_y: u32,
    roi_width: u32,
    roi_height: u32,
) -> Result<Vec<f64>, JsError> {
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| JsError::new(&format!("Image decode: {e}")))?
        .to_rgb8();

    let mut img = img;
    processing::image_utils::convert_dark_mode(&mut img);

    Ok(processing::bar_extraction::slice_image(
        &img, roi_x, roi_y, roi_width, roi_height,
    ))
}

/// Detect the bar-chart grid bounds using line-based (no OCR) detection.
///
/// Args:
///     image_bytes: Raw PNG or JPEG bytes
///
/// Returns:
///     JSON object `{upper_left_x, upper_left_y, lower_right_x, lower_right_y}`
///     or `null` if detection fails.
#[wasm_bindgen]
pub fn detect_grid_line_based_bytes(image_bytes: &[u8]) -> Result<JsValue, JsError> {
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| JsError::new(&format!("Image decode: {e}")))?
        .to_rgb8();

    let mut img = img;
    processing::image_utils::convert_dark_mode(&mut img);

    let result = processing::grid_detection::detect_grid(&img, DetectionMethod::LineBased)
        .map_err(|e| JsError::new(&format!("Grid detection: {e}")))?;

    match (result.success, result.bounds) {
        (true, Some(b)) => {
            let obj = serde_wasm_bindgen::to_value(&GridBoundsJs {
                upper_left_x: b.upper_left_x,
                upper_left_y: b.upper_left_y,
                lower_right_x: b.lower_right_x,
                lower_right_y: b.lower_right_y,
            })
            .map_err(|e| JsError::new(&e.to_string()))?;
            Ok(obj)
        }
        _ => Ok(JsValue::NULL),
    }
}

#[derive(serde::Serialize)]
struct GridBoundsJs {
    upper_left_x: i32,
    upper_left_y: i32,
    lower_right_x: i32,
    lower_right_y: i32,
}
```

- [ ] **Step 4: Verify the crate compiles for WASM target (type-check only)**

```bash
cargo check --target wasm32-unknown-unknown -p screenshot-processor-wasm
```

Expected: exits with code 0. Note: `cargo build` won't work for `cdylib` crates targeting WASM on a native host — use `cargo check` for sanity checking and `wasm-pack build` (Task 3) for the actual artifact.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/wasm-bindings/
git commit -m "feat: add crates/wasm-bindings with wasm-bindgen exports for browser"
```

---

### Task 3: Build script + wasm-pack integration

**Files:**
- Create: `scripts/build-wasm.sh`
- Modify: `frontend/package.json`

- [ ] **Step 1: Install wasm-pack (if not present)**

```bash
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
# Or: cargo install wasm-pack
wasm-pack --version
```

Expected: version output (e.g. `wasm-pack 0.13.x`)

- [ ] **Step 2: Create `scripts/build-wasm.sh`**

```bash
#!/usr/bin/env bash
# Build the Rust WASM module and copy output to frontend/public/wasm/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/frontend/public/wasm"

echo "Building screenshot-processor-wasm..."
cd "$PROJECT_ROOT"
wasm-pack build crates/wasm-bindings \
    --target web \
    --out-dir "$OUTPUT_DIR" \
    --out-name screenshot_processor_wasm \
    --release

echo "WASM build complete: $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"
```

```bash
chmod +x scripts/build-wasm.sh
```

- [ ] **Step 3: Run the build script**

```bash
./scripts/build-wasm.sh
```

Expected: creates `frontend/public/wasm/screenshot_processor_wasm.js` and `screenshot_processor_wasm_bg.wasm`

- [ ] **Step 4: Check output size**

```bash
ls -lh frontend/public/wasm/
```

Expected: `.wasm` file around 100-500KB (much smaller than Tesseract.js's ~10MB)

- [ ] **Step 5: Add `build:wasm` to `frontend/package.json`**

```json
"scripts": {
    ...
    "build:wasm": "bash ../scripts/build-wasm.sh",
    ...
}
```

- [ ] **Step 6: Add `frontend/public/wasm/*.wasm` to `.gitignore` (keep JS glue but not the binary)**

```bash
echo "frontend/public/wasm/*.wasm" >> .gitignore
```

Actually — check team preference. If shipping with git, remove this step. WASM binaries are large but reproducibly buildable.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-wasm.sh frontend/package.json
git commit -m "feat: add wasm-pack build script for browser screenshot processing"
```

---

### Task 4: TypeScript wrapper for the WASM module

**Files:**
- Create: `frontend/src/core/implementations/wasm/processing/screenshotProcessorWasm.ts`

This module handles lazy WASM initialization and wraps the raw wasm-bindgen bindings in a clean TypeScript API that the worker can call.

- [ ] **Step 1: Create `screenshotProcessorWasm.ts`**

```typescript
/**
 * Lazy-initialized Rust WASM module for bar extraction and grid detection.
 *
 * The module is loaded on first use — not at worker startup — to avoid
 * blocking initialization time when the WASM isn't needed yet.
 */

interface GridBounds {
  upper_left_x: number;
  upper_left_y: number;
  lower_right_x: number;
  lower_right_y: number;
}

type WasmModule = typeof import("/wasm/screenshot_processor_wasm.js");

let wasmModule: WasmModule | null = null;
let initPromise: Promise<WasmModule | null> | null = null;

async function getWasmModule(): Promise<WasmModule | null> {
  if (wasmModule) return wasmModule;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Dynamic import works inside Web Workers
      const mod = await import(/* @vite-ignore */ "/wasm/screenshot_processor_wasm.js");
      await mod.default(); // wasm-bindgen init() call
      wasmModule = mod;
      return mod;
    } catch (e) {
      console.warn("[screenshotProcessorWasm] WASM unavailable, falling back to Canvas:", e);
      return null;
    }
  })();

  return initPromise;
}

/**
 * Extract 24 hourly values from a pre-sliced image ROI.
 * Returns null if WASM is unavailable (caller should use Canvas fallback).
 */
export async function sliceImageBytesWasm(
  imageBytes: Uint8Array,
  roiX: number,
  roiY: number,
  roiWidth: number,
  roiHeight: number,
): Promise<number[] | null> {
  const mod = await getWasmModule();
  if (!mod) return null;

  try {
    const result = mod.slice_image_bytes(imageBytes, roiX, roiY, roiWidth, roiHeight);
    return Array.from(result);
  } catch (e) {
    console.warn("[screenshotProcessorWasm] slice_image_bytes failed:", e);
    return null;
  }
}

/**
 * Detect the bar-chart grid using line-based detection (no OCR).
 * Returns null if WASM unavailable or grid not found.
 */
export async function detectGridLineBasedWasm(
  imageBytes: Uint8Array,
): Promise<GridBounds | null> {
  const mod = await getWasmModule();
  if (!mod) return null;

  try {
    return mod.detect_grid_line_based_bytes(imageBytes) as GridBounds | null;
  } catch (e) {
    console.warn("[screenshotProcessorWasm] detect_grid_line_based_bytes failed:", e);
    return null;
  }
}

/** Warm up the WASM module eagerly (call at worker startup). */
export async function warmupWasm(): Promise<void> {
  await getWasmModule();
}
```

Note: Functions are named `sliceImageBytesWasm` and `detectGridLineBasedWasm` (with `Wasm` suffix) to avoid naming collisions with the existing Canvas implementations in the worker (`detectGridLineBased` is already imported from `lineBasedDetection.canvas`).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/core/implementations/wasm/processing/screenshotProcessorWasm.ts
git commit -m "feat: add TypeScript wrapper for Rust WASM screenshot processing"
```

---

### Task 5: Wire WASM into the browser worker

**Files:**
- Modify: `frontend/src/core/implementations/wasm/processing/workers/imageProcessor.worker.canvas.ts`

The worker handles `EXTRACT_HOURLY_DATA` (bar extraction) and `DETECT_GRID` (line-based) messages. Both should try WASM first, then fall back to the existing Canvas implementations.

**Image bytes:** The worker receives `payload.imageData` (raw `ImageData` from the caller) which is converted to a `CanvasMat` at the top of each handler. For WASM we need PNG bytes, not a `CanvasMat`. Use `payload.imageData` directly (before mat conversion) via `OffscreenCanvas.convertToBlob`:

```typescript
async function imageDataToBytes(imageData: ImageData): Promise<Uint8Array> {
  const oc = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = oc.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  const blob = await oc.convertToBlob({ type: "image/png" });
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}
```

The Rust WASM functions accept PNG bytes and perform dark mode conversion themselves — so passing the pre-conversion `ImageData` is correct.

**Message types:** Responses use `EXTRACT_HOURLY_DATA_COMPLETE` and `DETECT_GRID_COMPLETE` (matching the existing response type union in `types.ts`).

- [ ] **Step 1: Read the current worker file to understand the handler signatures**

Before editing, verify the `handleExtractHourlyData` and `handleDetectGrid` function signatures match what the plan describes:

```bash
grep -n "handleExtractHourlyData\|handleDetectGrid\|payload.imageData\|payload.gridCoordinates\|payload.method" \
    frontend/src/core/implementations/wasm/processing/workers/imageProcessor.worker.canvas.ts | head -20
```

- [ ] **Step 2: Add imports and `imageDataToBytes` helper at top of worker**

Add after existing imports:

```typescript
import { sliceImageBytesWasm, detectGridLineBasedWasm, warmupWasm } from "../screenshotProcessorWasm";
```

Add `imageDataToBytes` helper function near the top of the file (after imports, before handlers):

```typescript
async function imageDataToBytes(imageData: ImageData): Promise<Uint8Array> {
  const oc = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = oc.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  const blob = await oc.convertToBlob({ type: "image/png" });
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}
```

- [ ] **Step 3: Add WASM warmup to `handleInitialize`**

In `handleInitialize`, after the `await initialize()` call:

```typescript
await warmupWasm(); // non-blocking — failure logs a warning and Canvas fallback is used
```

- [ ] **Step 4: Wire WASM into `handleExtractHourlyData`**

The current handler:
```typescript
async function handleExtractHourlyData(id, payload) {
  const mat = imageDataToMat(payload.imageData);
  const darkModeConverted = convertDarkMode(mat);
  const hourlyData = extractHourlyData(darkModeConverted, payload.gridCoordinates, ...);
  const response = { type: "EXTRACT_HOURLY_DATA_COMPLETE", id, payload: { hourlyData } };
  self.postMessage(response);
}
```

Replace with WASM-first, Canvas fallback:

```typescript
async function handleExtractHourlyData(
  id: string,
  payload: ExtractHourlyDataMessage["payload"],
): Promise<void> {
  // Try Rust WASM first (faster)
  const { upper_left, lower_right } = payload.gridCoordinates;
  const roiX = upper_left.x;
  const roiY = upper_left.y;
  const roiWidth = lower_right.x - upper_left.x;
  const roiHeight = lower_right.y - upper_left.y;

  const imageBytes = await imageDataToBytes(payload.imageData);
  const wasmResult = await sliceImageBytesWasm(imageBytes, roiX, roiY, roiWidth, roiHeight);

  if (wasmResult !== null) {
    const response: WorkerResponse = {
      type: "EXTRACT_HOURLY_DATA_COMPLETE",
      id,
      payload: { hourlyData: wasmResult },
    };
    self.postMessage(response);
    return;
  }

  // Canvas fallback
  if (!tesseractWorker) {
    throw new Error("Worker not initialized - Tesseract not available");
  }
  const mat = imageDataToMat(payload.imageData);
  const darkModeConverted = convertDarkMode(mat);
  const hourlyData = extractHourlyData(
    darkModeConverted,
    payload.gridCoordinates,
    payload.imageType === "battery",
  );
  const response: WorkerResponse = {
    type: "EXTRACT_HOURLY_DATA_COMPLETE",
    id,
    payload: { hourlyData },
  };
  self.postMessage(response);
}
```

**Note on `isBattery`:** The Canvas fallback passes `payload.imageType === "battery"` to `extractHourlyData`. The WASM `slice_image_bytes` doesn't take an `imageType` param — it always uses screen time bar heights. Check if `isBattery` affects bar extraction in the Canvas implementation; if it does, WASM path may need the Canvas fallback for battery screenshots until the WASM crate is updated.

- [ ] **Step 5: Wire WASM into `handleDetectGrid` (line-based only)**

The current line-based handler:
```typescript
if (payload.method === "line_based") {
  const result = detectGridLineBased(darkModeConverted);
  gridCoordinates = result.gridCoordinates;
}
```

Replace with WASM-first, Canvas fallback. Note the existing `detectGridLineBased` import from `lineBasedDetection.canvas` is already in scope — no naming collision since the WASM wrapper is `detectGridLineBasedWasm`:

```typescript
if (payload.method === "line_based") {
  // Try Rust WASM first
  const imageBytes = await imageDataToBytes(payload.imageData);
  const wasmGrid = await detectGridLineBasedWasm(imageBytes);

  if (wasmGrid !== null) {
    // Convert flat GridBoundsJs to the worker's GridCoordinates format
    gridCoordinates = {
      upper_left: { x: wasmGrid.upper_left_x, y: wasmGrid.upper_left_y },
      lower_right: { x: wasmGrid.lower_right_x, y: wasmGrid.lower_right_y },
    };
  } else {
    // Canvas fallback
    const mat = imageDataToMat(payload.imageData);
    const darkModeConverted = convertDarkMode(mat);
    const result = detectGridLineBased(darkModeConverted);
    gridCoordinates = result.gridCoordinates;
  }
}
```

**Important:** The WASM returns `{upper_left_x, upper_left_y, lower_right_x, lower_right_y}` (flat format from `GridBoundsJs`), but the worker's `GridCoordinates` type uses `{upper_left: {x, y}, lower_right: {x, y}}`. The conversion above handles this. Check `types.ts` to confirm the exact type shape before editing.

- [ ] **Step 6: Run Playwright e2e tests to verify WASM mode works**

```bash
cd frontend
bun run test:e2e -- --grep "wasm\|process\|upload" 2>&1 | tail -30
```

Expected: relevant tests still pass

- [ ] **Step 7: Manual smoke test**

Open the app in WASM mode, upload a screenshot, verify:
- Processing completes without errors
- Console shows `[screenshotProcessorWasm]` init message (not warning)
- Hourly values are extracted correctly

- [ ] **Step 8: Commit**

```bash
git add frontend/src/core/implementations/wasm/processing/workers/imageProcessor.worker.canvas.ts
git commit -m "feat: use Rust WASM for bar extraction and grid detection in browser worker"
```

---

### Task 6: Add WASM build to Docker frontend build

**Files:**
- Modify: `docker/frontend/Dockerfile` (production build)
- Modify: `docker/frontend/Dockerfile.dev`

The WASM must be built before `bun run build` in the Docker image.

**Build context note:** The `docker/frontend/Dockerfile` build context is the project root (same as the backend). Verify this in `docker/docker-compose.yml` — the `frontend` service should have `context: ..` or `context: .` (from docker/ dir) with the root as context. If the Dockerfile uses `COPY crates/` it must be reachable from the build context. Check `docker/docker-compose.yml` `build.context` for the frontend service before editing the Dockerfile.

- [ ] **Step 1: Verify the Docker build context**

```bash
grep -A5 "frontend:" docker/docker-compose.yml | grep "context\|dockerfile"
grep -A5 "frontend:" docker/docker-compose.dev.yml | grep "context\|dockerfile"
```

Confirm `context` is the project root (i.e., `..` when Compose file is in `docker/`, or `.` when in project root). If context is not the project root, adjust the `COPY` paths in the next step accordingly.

- [ ] **Step 2: Add Rust + wasm-pack to the frontend Dockerfile build stage**

In the production `Dockerfile` build stage (before `RUN bun run build`):

```dockerfile
# Install Rust + wasm-pack for building the screenshot processor WASM module
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Copy Rust workspace files needed for WASM build
COPY crates/ /app/crates/
COPY Cargo.toml Cargo.lock /app/

# Build WASM module (outputs to frontend/public/wasm/)
RUN bash scripts/build-wasm.sh
```

Place this BEFORE the `bun run build` step so the WASM files are in `public/wasm/` when Vite builds.

- [ ] **Step 3: Verify Docker build**

```bash
docker compose --env-file docker/.env -f docker/docker-compose.dev.yml build frontend 2>&1 | tail -20
```

Expected: build succeeds, `public/wasm/` files present

- [ ] **Step 4: Commit**

```bash
git add docker/frontend/Dockerfile docker/frontend/Dockerfile.dev
git commit -m "feat: add Rust/wasm-pack to frontend Docker build for WASM module"
```

---

## Notes

**Performance expectations:**
- Bar extraction: Canvas JS ~50-200ms → Rust WASM ~2-10ms (~20-30x improvement)
- Line-based grid detection: Canvas JS ~30-100ms → Rust WASM ~5-20ms (~10-15x improvement)
- WASM module size: ~100-500KB (added to initial load; cached after first download)
- WASM init time: ~50-200ms (one-time per worker spawn)

**Browser compatibility:**
- `OffscreenCanvas.convertToBlob` requires Chrome 69+, Firefox 105+, Safari 16.4+
- WASM is supported by all modern browsers
- If `OffscreenCanvas.convertToBlob` is unavailable, the Canvas fallback runs transparently

**WASM vs Tesseract.js:**
- Tesseract.js is ~10MB and takes 2-5 seconds to initialize
- The Rust WASM is ~100-500KB and initializes in ~50-200ms
- Both coexist: Rust handles pixel processing, Tesseract handles text recognition

**Battery mode note:**
- The Canvas `extractHourlyData` accepts an `isBattery` flag that may affect bar color thresholds
- The WASM `slice_image_bytes` does not have this parameter
- If battery screenshots give wrong results with WASM, fall back to Canvas for `imageType === "battery"` until the WASM crate is updated with battery support

**Debugging:**
- If WASM loads but gives wrong results, compare Canvas vs WASM output on the same image
- `console.log(Array.from(wasmResult))` vs Canvas result for the same ROI
- The Rust `bar_extraction::slice_image` and Canvas `barExtraction.canvas.ts` should produce identical results (they're ports of the same algorithm)
