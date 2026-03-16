# Autoresearch Ideas

## Dead Ends (tried and failed)
<!-- Move ideas here when they don't work, with a note on WHY -->

- **Batch column extraction (exp2)** — extracting all 24 columns at once instead of one-by-one. Marginal/noise improvement; the per-column slice is already cheap and numpy doesn't benefit much from batching thin slices.
- **Squared L2 distance in `remove_all_but` (exp6)** — avoiding `np.sqrt` by comparing squared distances. Correct optimization but `remove_all_but` is not in the hot path, so no measurable pipeline impact.
- **In-place operations** — `np.multiply(img, mask, out=img)` etc. Not needed after switching to OpenCV intrinsics which handle memory internally.
- **Contiguous memory (`np.ascontiguousarray`)** — OpenCV functions handle this internally; explicit calls added no benefit.
- **Batch colorspace conversion** — pipeline stages don't share colorspace needs, so converting once at the start doesn't help.
- **Early exit in `slice_image` for all-white columns** — after exp8 (fully vectorized loop), there is no per-column Python iteration to exit from.

## Key Insights
- Prior pass: vectorizing per-pixel Python loops gave 50-100x speedup
- Prior pass: pre-compiling regexes saved ~30% on OCR text parsing
- **OpenCV C++ intrinsics massively beat numpy for image ops.** `cv2.threshold` + `cv2.bitwise_and` was 38x faster than numpy boolean indexing for `darken_non_white`. This was the single biggest win.
- **`cv2.LUT` is the fastest way to do per-pixel value remapping.** Replaced `np.take` in `reduce_color_count` — a 256-entry lookup table applied in C++ beats any numpy approach.
- **Eliminating unnecessary work beats micro-optimizing it.** Removing `scale_up` from the `slice_image` hot path (exp4) gave a large improvement because binarized images don't need upscaling at all.
- **`cv2.mean` is faster than `np.mean` for images.** OpenCV's implementation is optimized for 2D/3D arrays with uint8 dtype.
- **Avoiding dtype promotion is free performance.** The `is_white` check (exp7) was promoting uint8 to int16 by subtracting columns; switching to `>= 253` keeps everything in uint8.
- **Vectorizing the last Python loop is critical.** The 24-column bar extraction loop (exp8) was the final bottleneck; broadcasting a column-index mask eliminated it entirely.
- **Profile the actual hot path first.** exp6 (squared L2) was algorithmically sound but wasted effort because `remove_all_but` is rarely called in the benchmark path.

## What Worked (ranked by impact)

1. **exp1: cv2.threshold + cv2.bitwise_and in darken_non_white** — 38x faster on darken_us. The biggest single win. OpenCV's compiled C++ threshold + bitwise ops crush numpy boolean indexing.
2. **exp4: eliminate scale_up from slice_image** — Removing unnecessary work entirely. Binarized images don't need upscaling.
3. **exp8: fully vectorized 24-column loop** — Broadcast mask eliminates the last Python for-loop in the hot path.
4. **exp3: cv2.LUT in reduce_color_count** — LUT approach is ideal for palette remapping.
5. **exp5: cv2.mean + cv2.bitwise_not in convert_dark_mode** — Faster than np.mean + 255-img.
6. **exp7: simplified is_white (>= 253)** — Avoids int16 dtype promotion.

## What Didn't Work (or was marginal)

1. **exp2: batch column extraction** — Marginal. Thin column slices are already cheap.
2. **exp6: squared L2 in remove_all_but** — Correct but not in hot path. No pipeline impact.

## Remaining Ideas

### Medium Confidence
- [ ] **Reduce dtype width** — if any remaining intermediate computations use int16/int32, check if uint8 suffices
- [ ] **Use `cv2.convertScaleAbs()` for contrast/brightness** — faster than manual numpy arithmetic (may already be moot after exp1-8)
- [ ] **Use `cv2.inRange()` instead of manual masking** — for any remaining color range checks

### Low Confidence / Speculative
- [ ] **Numba JIT** — would add a dependency, but @njit on hot loops could match C speed
- [ ] **OpenCV UMat (GPU)** — transparent GPU acceleration, but may not be available in Docker
- [ ] **Cython** — compile hot paths to C, significant build complexity
- [ ] **Downscale before processing** — process at 50% resolution for detection, then extract at full res
- [ ] **Parallel pipeline stages** — run independent stages concurrently with ThreadPoolExecutor
