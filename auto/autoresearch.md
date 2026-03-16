# Autoresearch: Optimize Image Processing Pipeline Latency

## Objective
Minimize wall-clock time of the core image processing pipeline (dark mode → contrast → darken → reduce → bar extraction → OCR text parsing). The agent runs an autonomous experiment loop: edit → commit → benchmark → keep/discard. Each change is validated before benchmarking. Changes that regress correctness or the primary metric are reverted immediately.

## Metrics
- **Primary (optimization target)**: `pipeline_us` (microseconds, lower is better) — mean time of `test_full_normalization_pipeline_speed` benchmark
- **Secondary**: `slice_us` (microseconds, lower is better) — mean time of `test_slice_image_speed`
- **Secondary**: `darken_us` (microseconds, lower is better) — mean time of `test_darken_non_white_speed`

## How to Run
`./auto/autoresearch.sh` — copies test files to Docker container, runs pre-checks, then benchmarks, outputs `METRIC name=number` lines.

## Files in Scope
These are the files the agent MAY modify to optimize performance:

| File | What it does |
|------|-------------|
| `src/screenshot_processor/core/image_utils.py` | Dark mode conversion, darken_non_white, reduce_color_count, scale_up, contrast adjustment, color extraction |
| `src/screenshot_processor/core/bar_extraction.py` | slice_image (24 hourly bar heights), compute_bar_alignment_score |
| `src/screenshot_processor/core/image_processor.py` | Grid detection orchestration, ROI calculation, process_image pipeline |
| `src/screenshot_processor/core/ocr.py` | OCR text extraction, time parsing, regex-based normalization |
| `src/screenshot_processor/core/grid_detectors.py` | Grid boundary detection strategies |
| `src/screenshot_processor/core/bar_processor.py` | Bar height extraction from graph |
| `src/screenshot_processor/core/line_based_detection/` | Line detection strategies |

## Off Limits
- **Tests** (`tests/`) — NEVER modify test files
- **Database models** (`web/database/`) — schema changes break migrations
- **API routes** (`web/api/`) — not in the hot path
- **Frontend** (`frontend/`) — separate stack
- **Benchmark files** (`tests/benchmark/`) — the measurement tools themselves
- **Configuration** (`.env`, `docker/`, `alembic/`) — infrastructure

## Constraints
1. **All existing tests must pass.** Run `./auto/autoresearch.checks.sh` to verify.
2. **No new dependencies.** Only use numpy, opencv-python, pillow, and stdlib.
3. **Semantic correctness preserved.** Same inputs → same outputs (within floating point tolerance). The image processing pipeline extracts hourly screen time data from screenshots — wrong values are worse than slow values.
4. **No `.copy()` unless mutation is needed.** Eliminated redundant copies in prior optimization pass.
5. **Numpy vectorization preferred.** Per-pixel Python loops were already vectorized in prior pass — look for remaining loops or numpy anti-patterns.
6. **Pre-compiled regexes.** Already done in prior pass — look for remaining inline `re.compile()` or `re.sub()`.

## Strategic Direction
The prior optimization pass (commit 6b236f8) already:
- Vectorized all per-pixel loops with numpy (50-100x speedup)
- Pre-compiled 40+ regex patterns at module level
- Eliminated 6 redundant `.copy()` calls
- Combined multiple DB queries into single queries

**Next-level optimizations to explore:**
1. **numpy dtype optimization** — Are we using int16 intermediates where uint8 suffices? Can we avoid `.astype()` conversions?
2. **OpenCV vs numpy** — OpenCV functions (compiled C++) are often faster than numpy equivalents. `cv2.threshold()` vs `np.where()`, `cv2.inRange()` vs manual masking.
3. **Memory layout** — `np.ascontiguousarray()` for non-contiguous slices before heavy computation.
4. **Avoid unnecessary colorspace conversions** — `cv2.cvtColor()` is expensive. Can we skip conversions that aren't needed?
5. **Reduce allocations** — Can intermediate results be computed in-place? `np.add(a, b, out=result)` vs `result = a + b`.
6. **K-means in reduce_color_count** — Can we use a faster quantization method? OpenCV's `cv2.kmeans` vs a simpler fixed-palette approach?
7. **Lazy computation** — Skip pipeline stages when input characteristics make them unnecessary (e.g., skip dark mode conversion for already-light images — this may already be done).
8. **SIMD-friendly operations** — Ensure numpy operations use contiguous memory and aligned dtypes.
9. **Profile-guided** — Use `python -X importtime` or `cProfile` output to find remaining hotspots.

## Initial Baseline
- **Commit**: `dafae01` (main, 2026-03-15)
- **pipeline_us**: 2242 (2.24ms mean, full normalization pipeline on 500×300 image)
- **slice_us**: 2226 (2.23ms mean, slice_image on 600×200 ROI)
- **darken_us**: 2013 (2.01ms mean, darken_non_white on 500×300 image)

## What's Been Tried
### Prior Pass (commit 6b236f8)
- ✅ Vectorized `remove_line_color()` — L1 distance with numpy broadcasting
- ✅ Vectorized `extract_line()` — row-wise sum of close_mask
- ✅ Vectorized `extract_line_snap_to_grid()` — same pattern
- ✅ Vectorized bar height counting in `slice_image()` — `np.where` + `np.sum`
- ✅ Vectorized blue bar detection in `compute_bar_alignment_score()`
- ✅ Pre-compiled 40+ regex patterns at module level
- ✅ Eliminated 6 redundant `.copy()` calls
- ✅ Fixed `mse_between_loaded_images` to skip resize when dimensions match

### Autoresearch Experiments (2026-03-15)

| Exp | Change | Impact | Status |
|-----|--------|--------|--------|
| exp1 | `cv2.threshold` + `cv2.bitwise_and` replacing numpy boolean indexing in `darken_non_white` | **38x faster** on darken_us (2013→51) | ✅ Kept |
| exp2 | Batch column extraction in `slice_image` | Marginal / within noise | ✅ Kept (no harm) |
| exp3 | `cv2.LUT` replacing `np.take` in `reduce_color_count` | Measurable improvement | ✅ Kept |
| exp4 | Eliminated `scale_up` from `slice_image` hot path (binarized images make it redundant) | Significant — removed unnecessary work | ✅ Kept |
| exp5 | `cv2.mean` + `cv2.bitwise_not` replacing `np.mean` + `255-img` in `convert_dark_mode` | Measurable improvement | ✅ Kept |
| exp6 | Squared L2 distance in `remove_all_but` (avoid `np.sqrt`) | Marginal — not in hot path | ✅ Kept (no harm) |
| exp7 | Simplified `is_white` check — `columns >= 253` avoids int16 alloc | Measurable improvement | ✅ Kept |
| exp8 | Fully vectorized 24-column loop in `slice_image` with broadcast mask | Significant — eliminates Python loop | ✅ Kept |

## Final Results

| Metric | Baseline | Final | Change | Speedup |
|--------|----------|-------|--------|---------|
| **pipeline_us** | 2242 | 278 | -87.6% | **8x** |
| **slice_us** | 2226 | 275 | -87.6% | **8x** |
| **darken_us** | 2013 | 51 | -97.5% | **39x** |

## Baseline
- **Commit**: `dafae01` (main, 2026-03-15)
- **pipeline_us**: 2242
- **slice_us**: 2226
- **darken_us**: 2013

## Current Best
- **pipeline_us**: 278
- **slice_us**: 275
- **darken_us**: 51
