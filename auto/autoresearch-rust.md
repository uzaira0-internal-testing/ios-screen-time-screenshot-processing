# Autoresearch: Rust Image Processing Optimization

## Goal
Optimize the Rust-native image processing pipeline in `frontend/src-tauri/src/processing/`
to maximize throughput on real iOS Screen Time screenshots.

## Metrics

| Metric | Benchmark | What it measures |
|--------|-----------|-----------------|
| `pipeline_us` | Full `process_image` on test image | End-to-end processing time |
| `slice_us` | `slice_image` on a 600×200 ROI | Bar extraction time |
| `grid_us` | `line_based::detect` on a known-res screenshot | Grid detection time |

## Convergence Rule

**Stop when no metric improves by >5% across 3 consecutive experiment cycles.**

## Optimization Ideas (ranked by expected impact)

1. **SIMD via auto-vectorization** — Rust iterators auto-vectorize well with `--release`.
   Profile with `RUSTFLAGS="-C target-cpu=native"` to enable AVX2.
2. **Rayon parallelism** — Parallelize the 24-column bar extraction across threads.
3. **Avoid allocations** — Pre-allocate buffers, reuse across pipeline stages.
   Use `img.as_raw()` for direct pixel access instead of `get_pixel()`.
4. **`unsafe` pixel access** — `get_pixel_unchecked` skipping bounds checks in hot loops
   (after correctness is proven with tests).
5. **Custom LUT with `[u8; 256]`** — Stack-allocated LUT vs heap for `reduce_color_count`.
6. **Raw slice iteration** — Replace `get_pixel(x, y)` with direct buffer indexing:
   `let idx = (y * width + x) * 3; let (r, g, b) = (buf[idx], buf[idx+1], buf[idx+2]);`
7. **Profile-guided optimization (PGO)** — `cargo pgo` with real images.
8. **Batch HSV conversion** — Pre-compute HSV for entire ROI once in `compute_bar_alignment_score`.

## Experiment Log

| # | Change | grid_ms | pipeline_ms | slice_µs | Delta (pipeline) |
|---|--------|---------|-------------|----------|------------------|
| 0 | Baseline (get_pixel + to_grayscale) | 21.1 | 23.0 | 212 | — |
| 1 | Raw buffer access + inline luma (no grayscale alloc) | 1.78 | 3.83 | 264 | **-83%** |
| 2 | Raw buffer in slice_image too | 1.72 | 2.73 | 228 | **-29%** |
| 3 | LUT-based contrast, raw remove_all_but | 1.71 | 2.90 | 228 | ~same |
| 4 | target-cpu=native (AVX2) | 1.58 | 2.47 | 256 | -15% (noisy) |
| 5 | Convergence check (3 runs) | 1.78 | 2.80 | 222 | <2% variance |

**Converged after 5 experiments.** No metric improved >5% across experiments 3-5.

### Final vs Baseline
| Metric | Baseline | Final | Speedup |
|--------|----------|-------|---------|
| grid_detect | 21.1 ms | 1.78 ms | **11.9x** |
| full_pipeline | 23.0 ms | 2.80 ms | **8.2x** |
| slice_image | 212 µs | 222 µs | ~same |

### Real image end-to-end (including image load)
| | Python | Rust | Speedup |
|--|--------|------|---------|
| Avg/image | 156 ms | 6.7 ms | **23x** |

## Running

```bash
./auto/autoresearch-rust.sh
```

## Files

| File | Purpose |
|------|---------|
| `auto/autoresearch-rust.sh` | Benchmark runner (cargo test + cargo bench) |
| `frontend/src-tauri/src/processing/` | Rust processing module |
| `frontend/src-tauri/benches/processing_benchmark.rs` | Criterion benchmarks (create after baseline) |
