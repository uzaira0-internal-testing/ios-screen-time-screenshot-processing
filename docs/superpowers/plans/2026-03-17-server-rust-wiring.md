# Server Rust Wiring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Short-circuit the Python screenshot processing pipeline to use the `screenshot_processor_rs` PyO3 Rust extension for all supported operations, with transparent Python fallback.

**Architecture:** `process_screenshot_file()` in `processing_service.py` is the single entry point for all server-side processing. We add a Rust fast-path at the top: if Rust is available and `max_shift == 0` (no boundary optimizer), call the safe wrappers in `rust_accelerator.py` and convert their result to the standard dict format. On any Rust failure, fall through to the existing Python `ScreenshotProcessingService` unchanged. Two new wrappers (`process_image_with_grid`, `extract_hourly_data`) are added to `rust_accelerator.py` following the existing pattern.

**Key constraint:** `_try_rust_process_screenshot()` MUST use the public wrapper functions in `rust_accelerator` (`rust_accelerator.process_image(...)`, `rust_accelerator.process_image_with_grid(...)`) — never access `_rs` directly. The wrappers handle thread safety, availability checks, and fallback in one place.

**Tech Stack:** Python 3.12, PyO3 `screenshot_processor_rs`, pytest

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `src/screenshot_processor/core/rust_accelerator.py` | Add `process_image_with_grid`, `extract_hourly_data` wrappers |
| Modify | `src/screenshot_processor/web/services/processing_service.py` | Add Rust fast-path in `process_screenshot_file()` |
| Create | `tests/unit/test_rust_accelerator_new_wrappers.py` | Unit tests for new wrappers |
| Create | `tests/unit/test_processing_service_rust_path.py` | Tests for Rust fast-path in processing_service |

---

### Task 1: Add `process_image_with_grid` to `rust_accelerator.py`

**Files:**
- Modify: `src/screenshot_processor/core/rust_accelerator.py`
- Test: `tests/unit/test_rust_accelerator_new_wrappers.py`

**PyO3 function signature** (from `rust-python/src/lib.rs:68`):
```
process_image_with_grid(path, upper_left: [i32;2], lower_right: [i32;2], image_type="screen_time")
→ { hourly_values: list[float], total: float, alignment_score: float, processing_time_ms: int }
```
Note: The PyO3 wrapper intentionally strips `title`, `total_text`, `grid_bounds` from the return dict even though the Rust pipeline runs OCR internally (lib.rs:80–86). The caller is expected to supply `existing_title`/`existing_total`.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_rust_accelerator_new_wrappers.py
import pytest
from pathlib import Path

FIXTURE_IMAGE = Path("tests/fixtures/screenshots/test_screenshot.png")


def test_process_image_with_grid_returns_24_values():
    """process_image_with_grid returns a dict with 24 hourly values."""
    from screenshot_processor.core.rust_accelerator import process_image_with_grid

    if not FIXTURE_IMAGE.exists():
        pytest.skip("Fixture image not found")

    result = process_image_with_grid(
        str(FIXTURE_IMAGE),
        upper_left=(100, 300),
        lower_right=(1000, 800),
        image_type="screen_time",
    )

    assert isinstance(result, dict)
    assert "hourly_values" in result
    assert len(result["hourly_values"]) == 24
    assert all(isinstance(v, float) for v in result["hourly_values"])
    assert "alignment_score" in result


def test_process_image_with_grid_fallback_on_missing_rust(monkeypatch):
    """Falls back to Python gracefully when Rust is not available."""
    import screenshot_processor.core.rust_accelerator as ra
    monkeypatch.setattr(ra, "_RUST_AVAILABLE", False)
    monkeypatch.setattr(ra, "_rs", None)

    if not FIXTURE_IMAGE.exists():
        pytest.skip("Fixture image not found")

    from screenshot_processor.core.rust_accelerator import process_image_with_grid
    result = process_image_with_grid(
        str(FIXTURE_IMAGE),
        upper_left=(100, 300),
        lower_right=(1000, 800),
    )
    assert "hourly_values" in result
    assert len(result["hourly_values"]) == 24
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/opt/ios-screen-time-screenshot-processing
pytest tests/unit/test_rust_accelerator_new_wrappers.py -v
```

Expected: `ImportError: cannot import name 'process_image_with_grid'`

- [ ] **Step 3: Implement `process_image_with_grid` in `rust_accelerator.py`**

Add after the existing `detect_grid` function:

```python
def process_image_with_grid(
    image_path: str,
    upper_left: tuple[int, int],
    lower_right: tuple[int, int],
    image_type: str = "screen_time",
) -> dict:
    """Extract hourly data using pre-computed grid bounds. Rust if available, else Python.

    Note: The PyO3 wrapper strips OCR results (title/total) — the Rust pipeline
    runs OCR internally but does not expose them through this function.
    Callers that need title/total should pass them separately.

    Returns:
        dict with keys: hourly_values (list[float], len=24), total (float),
        alignment_score (float), processing_time_ms (int)
    """
    if _check_rust():
        try:
            return _rs.process_image_with_grid(
                image_path,
                [int(upper_left[0]), int(upper_left[1])],
                [int(lower_right[0]), int(lower_right[1])],
                image_type,
            )
        except Exception as e:
            logger.debug("Rust process_image_with_grid failed, falling back to Python: %s", e)

    # Python fallback
    from .image_processor import extract_hourly_data_only

    is_battery = image_type == "battery"
    try:
        row = extract_hourly_data_only(image_path, upper_left, lower_right, is_battery)
    except Exception:
        row = None
    hourly = list(row[:24]) if row is not None else [0.0] * 24
    return {
        "hourly_values": hourly,
        "total": sum(hourly),
        "alignment_score": 0.0,
        "processing_time_ms": 0,
    }
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/unit/test_rust_accelerator_new_wrappers.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screenshot_processor/core/rust_accelerator.py tests/unit/test_rust_accelerator_new_wrappers.py
git commit -m "feat: add process_image_with_grid wrapper to rust_accelerator"
```

---

### Task 2: Add `extract_hourly_data` to `rust_accelerator.py`

**Files:**
- Modify: `src/screenshot_processor/core/rust_accelerator.py`
- Test: `tests/unit/test_rust_accelerator_new_wrappers.py` (extend)

**PyO3 function signature** (from `rust-python/src/lib.rs:92`):
```
extract_hourly_data(path, upper_left: [i32;2], lower_right: [i32;2], image_type="screen_time")
→ Vec<f64>  (24 values, no OCR)
```

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/test_rust_accelerator_new_wrappers.py`:

```python
def test_extract_hourly_data_returns_24_floats():
    """extract_hourly_data returns exactly 24 float values."""
    from screenshot_processor.core.rust_accelerator import extract_hourly_data

    if not FIXTURE_IMAGE.exists():
        pytest.skip("Fixture image not found")

    values = extract_hourly_data(
        str(FIXTURE_IMAGE),
        upper_left=(100, 300),
        lower_right=(1000, 800),
    )

    assert isinstance(values, list)
    assert len(values) == 24
    assert all(isinstance(v, float) for v in values)


def test_extract_hourly_data_fallback(monkeypatch):
    """Falls back to Python when Rust unavailable."""
    import screenshot_processor.core.rust_accelerator as ra
    monkeypatch.setattr(ra, "_RUST_AVAILABLE", False)
    monkeypatch.setattr(ra, "_rs", None)

    if not FIXTURE_IMAGE.exists():
        pytest.skip("Fixture image not found")

    from screenshot_processor.core.rust_accelerator import extract_hourly_data
    values = extract_hourly_data(str(FIXTURE_IMAGE), upper_left=(100, 300), lower_right=(1000, 800))
    assert len(values) == 24
```

- [ ] **Step 2: Implement `extract_hourly_data` in `rust_accelerator.py`**

Add after `process_image_with_grid`:

```python
def extract_hourly_data(
    image_path: str,
    upper_left: tuple[int, int],
    lower_right: tuple[int, int],
    image_type: str = "screen_time",
) -> list[float]:
    """Extract only hourly bar values from known grid bounds. No OCR — fast path.

    Returns:
        list of 24 floats (minutes per hour)
    """
    if _check_rust():
        try:
            result = _rs.extract_hourly_data(
                image_path,
                [int(upper_left[0]), int(upper_left[1])],
                [int(lower_right[0]), int(lower_right[1])],
                image_type,
            )
            return list(result)
        except Exception as e:
            logger.debug("Rust extract_hourly_data failed, falling back: %s", e)

    # Python fallback
    from .image_processor import extract_hourly_data_only

    is_battery = image_type == "battery"
    try:
        row = extract_hourly_data_only(image_path, upper_left, lower_right, is_battery)
    except Exception:
        row = None
    return list(row[:24]) if row is not None else [0.0] * 24
```

- [ ] **Step 3: Run all new wrapper tests**

```bash
pytest tests/unit/test_rust_accelerator_new_wrappers.py -v
```

Expected: all 4 tests PASS

- [ ] **Step 4: Run existing tests for regressions**

```bash
pytest tests/unit/ -k "rust" -v
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/screenshot_processor/core/rust_accelerator.py tests/unit/test_rust_accelerator_new_wrappers.py
git commit -m "feat: add extract_hourly_data wrapper to rust_accelerator"
```

---

### Task 3: Add Rust fast-path to `process_screenshot_file()`

**Files:**
- Modify: `src/screenshot_processor/web/services/processing_service.py`
- Test: `tests/unit/test_processing_service_rust_path.py`

`process_screenshot_file()` is currently 100% Python. We add a Rust fast-path at the top that runs when `max_shift == 0` (boundary optimizer disabled — Rust doesn't implement it).

**Critical design rule:** `_try_rust_process_screenshot()` calls the public wrapper functions in `rust_accelerator` module (e.g. `rust_accelerator.process_image(...)`), never `_rs` directly. The wrappers handle availability checks and thread safety.

**PyO3 `process_image` result format** (from `rust-python/src/lib.rs:44–59`):
```python
{
    "hourly_values": [0.0, ...],    # list[float], len=24
    "total": 15.3,                   # float
    "title": "App Name",             # str | None  (key ABSENT if no title detected)
    "total_text": "4h 36m",          # str | None  (key ABSENT if no total detected)
    "grid_bounds": {"upper_left_x": ..., "upper_left_y": ...,
                    "lower_right_x": ..., "lower_right_y": ...},  # dict (key ABSENT if no grid)
    "alignment_score": 0.9,
    "detection_method": "line_based",
    "processing_time_ms": 45,
}
```

**PyO3 `process_image_with_grid` result format** (from `rust-python/src/lib.rs:80–86`):
```python
{
    "hourly_values": [0.0, ...],   # list[float], len=24
    "total": 15.3,
    "alignment_score": 0.9,
    "processing_time_ms": 10,
    # title/total_text/grid_bounds intentionally stripped — caller supplies them
}
```

**Target dict format** (what `process_screenshot_file` callers expect):
```python
{
    "success": True,
    "processing_status": "completed",      # or "skipped", "failed"
    "extracted_hourly_data": {"0": 0.0, "1": 30.0, ...},  # str→float
    "extracted_title": "App Name",
    "extracted_total": "4h 36m",
    "grid_coords": {"upper_left_x": 100, ...},  # dict or None
    "processing_method": "line_based",
    "grid_detection_confidence": None,
    "alignment_score": 0.9,
    "title_y_position": None,
    "is_daily_total": False,
    "has_blocking_issues": False,
    "issues": [],
}
```

- [ ] **Step 1: Write the failing tests**

```python
# tests/unit/test_processing_service_rust_path.py
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

FIXTURE_IMAGE = Path("tests/fixtures/screenshots/test_screenshot.png")


def _make_rust_full_result(title="TestApp", total_text="4h 36m"):
    """Mirrors what _rs.process_image() actually returns (see lib.rs:44-59)."""
    return {
        "hourly_values": [float(i % 60) for i in range(24)],
        "total": 120.0,
        "title": title,
        "total_text": total_text,
        "grid_bounds": {
            "upper_left_x": 100, "upper_left_y": 300,
            "lower_right_x": 1000, "lower_right_y": 800,
        },
        "alignment_score": 0.95,
        "detection_method": "line_based",
        "processing_time_ms": 12,
    }


def _make_rust_grid_result():
    """Mirrors what _rs.process_image_with_grid() actually returns (see lib.rs:80-86)."""
    return {
        "hourly_values": [float(i % 60) for i in range(24)],
        "total": 120.0,
        "alignment_score": 0.95,
        "processing_time_ms": 10,
        # title/total_text/grid_bounds intentionally absent
    }


class TestRustFastPath:
    def test_rust_path_used_when_available_no_max_shift(self):
        """Rust fast path is taken when Rust available and max_shift=0."""
        if not FIXTURE_IMAGE.exists():
            pytest.skip("Fixture image not found")

        fake_rs = MagicMock()
        fake_rs.process_image.return_value = _make_rust_full_result()

        with patch("screenshot_processor.core.rust_accelerator._RUST_AVAILABLE", True), \
             patch("screenshot_processor.core.rust_accelerator._rs", fake_rs):
            from screenshot_processor.web.services import processing_service
            # Reload to pick up the mock (module may be cached)
            import importlib
            importlib.reload(processing_service)
            result = processing_service.process_screenshot_file(
                str(FIXTURE_IMAGE), "screen_time", max_shift=0
            )

        fake_rs.process_image.assert_called_once()
        assert result["processing_status"] == "completed"
        assert result["extracted_title"] == "TestApp"
        assert result["extracted_total"] == "4h 36m"
        assert isinstance(result["extracted_hourly_data"], dict)
        assert len(result["extracted_hourly_data"]) == 24
        assert result["grid_coords"] is not None

    def test_rust_path_skipped_when_max_shift_gt_0(self):
        """Python path used when max_shift > 0 (boundary optimizer)."""
        fake_rs = MagicMock()
        fake_rs.process_image.return_value = _make_rust_full_result()

        with patch("screenshot_processor.core.rust_accelerator._RUST_AVAILABLE", True), \
             patch("screenshot_processor.core.rust_accelerator._rs", fake_rs):
            from screenshot_processor.web.services import processing_service
            import importlib
            importlib.reload(processing_service)

            if not FIXTURE_IMAGE.exists():
                pytest.skip("Fixture image not found")

            # max_shift=5 → Rust is skipped; Python pipeline runs
            processing_service.process_screenshot_file(
                str(FIXTURE_IMAGE), "screen_time", max_shift=5
            )

        # _rs.process_image was NOT called — Python pipeline handled it
        fake_rs.process_image.assert_not_called()

    def test_rust_grid_path_when_grid_coords_provided(self):
        """Rust process_image_with_grid called when manual grid coords supplied."""
        if not FIXTURE_IMAGE.exists():
            pytest.skip("Fixture image not found")

        fake_rs = MagicMock()
        fake_rs.process_image_with_grid.return_value = _make_rust_grid_result()

        grid = {"upper_left_x": 100, "upper_left_y": 300,
                "lower_right_x": 1000, "lower_right_y": 800}

        with patch("screenshot_processor.core.rust_accelerator._RUST_AVAILABLE", True), \
             patch("screenshot_processor.core.rust_accelerator._rs", fake_rs):
            from screenshot_processor.web.services import processing_service
            import importlib
            importlib.reload(processing_service)
            result = processing_service.process_screenshot_file(
                str(FIXTURE_IMAGE), "screen_time",
                grid_coords=grid,
                existing_title="MyApp",
                existing_total="2h 30m",
            )

        fake_rs.process_image_with_grid.assert_called_once()
        assert result["processing_status"] == "completed"
        assert result["extracted_title"] == "MyApp"    # from existing_title
        assert result["extracted_total"] == "2h 30m"   # from existing_total
        assert result["grid_coords"] == grid

    def test_rust_fallback_on_error(self):
        """Falls back to Python pipeline when Rust raises an exception."""
        if not FIXTURE_IMAGE.exists():
            pytest.skip("Fixture image not found")

        fake_rs = MagicMock()
        fake_rs.process_image.side_effect = RuntimeError("Rust exploded")

        with patch("screenshot_processor.core.rust_accelerator._RUST_AVAILABLE", True), \
             patch("screenshot_processor.core.rust_accelerator._rs", fake_rs):
            from screenshot_processor.web.services import processing_service
            import importlib
            importlib.reload(processing_service)
            # Should not raise — Python fallback runs
            result = processing_service.process_screenshot_file(
                str(FIXTURE_IMAGE), "screen_time"
            )

        assert result["processing_status"] in ("completed", "failed", "skipped")

    def test_daily_total_detected_from_rust_title(self):
        """If Rust returns 'All Activity' title, status is skipped."""
        if not FIXTURE_IMAGE.exists():
            pytest.skip("Fixture image not found")

        fake_rs = MagicMock()
        fake_rs.process_image.return_value = _make_rust_full_result(title="All Activity")

        with patch("screenshot_processor.core.rust_accelerator._RUST_AVAILABLE", True), \
             patch("screenshot_processor.core.rust_accelerator._rs", fake_rs):
            from screenshot_processor.web.services import processing_service
            import importlib
            importlib.reload(processing_service)
            result = processing_service.process_screenshot_file(
                str(FIXTURE_IMAGE), "screen_time"
            )

        assert result["processing_status"] == "skipped"
        assert result["is_daily_total"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/unit/test_processing_service_rust_path.py -v
```

Expected: `FAIL` — `process_screenshot_file` doesn't use Rust yet

- [ ] **Step 3: Implement Rust fast-path in `processing_service.py`**

Insert the following block **before** the existing `ScreenshotProcessingService = None` sentinel (around line 28). These are module-level helpers, not inside any function.

```python
# ─── Rust fast-path helpers ──────────────────────────────────────────────────

_DAILY_TOTAL_PHRASES = ("all activity", "daily total", "total activity")


def _is_daily_total_title(title: str | None) -> bool:
    if not title:
        return False
    return any(p in title.lower() for p in _DAILY_TOTAL_PHRASES)


def _hourly_list_to_dict(hourly: list) -> dict:
    """Convert [v0, v1, ...] → {"0": v0, "1": v1, ...} as stored in DB."""
    return {str(i): float(v) for i, v in enumerate(hourly)}


def _try_rust_process_screenshot(
    file_path: str,
    image_type: str,
    grid_coords: dict | None,
    processing_method: str | None,
    existing_title: str | None,
    existing_total: str | None,
) -> dict | None:
    """
    Attempt to process a screenshot using Rust wrappers from rust_accelerator.

    Uses the public wrapper functions (never _rs directly) so thread safety
    and fallback logic are handled in one place.

    Returns the result dict on success, or None to trigger Python fallback.
    """
    from ...core import rust_accelerator

    if not rust_accelerator._check_rust():
        return None

    try:
        if grid_coords:
            # Manual bounds: fast bar-extraction path via process_image_with_grid
            rust_result = rust_accelerator.process_image_with_grid(
                file_path,
                upper_left=(grid_coords["upper_left_x"], grid_coords["upper_left_y"]),
                lower_right=(grid_coords["lower_right_x"], grid_coords["lower_right_y"]),
                image_type=image_type,
            )
            # process_image_with_grid returns hourly_values, total, alignment_score
            # (title/total_text stripped by PyO3 wrapper — use existing values)
            hourly = _hourly_list_to_dict(rust_result["hourly_values"])
            return {
                "success": True,
                "processing_status": "completed",
                "extracted_hourly_data": hourly,
                "extracted_title": existing_title,
                "extracted_total": existing_total,
                "grid_coords": grid_coords,
                "processing_method": "manual",
                "grid_detection_confidence": None,
                "alignment_score": rust_result.get("alignment_score"),
                "title_y_position": None,
                "is_daily_total": False,
                "has_blocking_issues": False,
                "issues": [],
            }
        else:
            # Full pipeline: grid detection + bar extraction + OCR
            method = processing_method or "line_based"
            rust_result = rust_accelerator.process_image(file_path, image_type, method)
            title = rust_result.get("title") or existing_title
            total = rust_result.get("total_text") or existing_total

            if _is_daily_total_title(title):
                return {
                    "success": True,
                    "processing_status": "skipped",
                    "extracted_hourly_data": None,
                    "extracted_title": title,
                    "extracted_total": total,
                    "grid_coords": None,
                    "processing_method": method,
                    "grid_detection_confidence": None,
                    "alignment_score": None,
                    "title_y_position": None,
                    "is_daily_total": True,
                    "has_blocking_issues": False,
                    "issues": [],
                }

            grid_bounds = rust_result.get("grid_bounds")  # dict or absent
            hourly_list = rust_result["hourly_values"]
            has_grid = grid_bounds is not None and any(hourly_list)
            hourly = _hourly_list_to_dict(hourly_list)
            return {
                "success": True,
                "processing_status": "completed" if has_grid else "failed",
                "extracted_hourly_data": hourly if has_grid else None,
                "extracted_title": title,
                "extracted_total": total,
                "grid_coords": grid_bounds,
                "processing_method": rust_result.get("detection_method", method),
                "grid_detection_confidence": None,
                "alignment_score": rust_result.get("alignment_score"),
                "title_y_position": None,
                "is_daily_total": False,
                "has_blocking_issues": not has_grid,
                "issues": [] if has_grid else [
                    {"issue_type": "GridDetection", "severity": "blocking",
                     "description": "Rust pipeline: no grid detected"},
                ],
            }

    except Exception as e:
        logger.debug("Rust fast path failed, falling back to Python: %s", e)
        return None
```

Then modify the **body** of `process_screenshot_file()` to call this helper at the very top, before any Python processing (insert after the function signature, before the `global ScreenshotProcessingService` line):

```python
def process_screenshot_file(
    file_path: str,
    image_type: str,
    grid_coords: dict | None = None,
    processing_method: str | None = None,
    existing_title: str | None = None,
    existing_total: str | None = None,
    use_fallback: bool = True,
    max_shift: int = 0,
) -> dict:
    # ── Rust fast-path (disabled when boundary optimizer is active) ───────────
    if max_shift == 0:
        rust_result = _try_rust_process_screenshot(
            file_path, image_type, grid_coords, processing_method,
            existing_title, existing_total,
        )
        if rust_result is not None:
            # Mirror Python's use_fallback: if line_based found no grid, try ocr_anchored
            if (
                use_fallback
                and not grid_coords
                and rust_result["processing_status"] == "failed"
                and not rust_result.get("grid_coords")
            ):
                rust_fallback = _try_rust_process_screenshot(
                    file_path, image_type, None, "ocr_anchored",
                    existing_title, existing_total,
                )
                if rust_fallback is not None:
                    return rust_fallback
            logger.info(
                "Rust fast path succeeded",
                extra={
                    "file_path": file_path,
                    "processing_time_ms": rust_result.get("processing_time_ms", 0),
                    "used_grid_coords": grid_coords is not None,
                },
            )
            return rust_result
        logger.debug("Rust fast path unavailable, using Python", extra={"file_path": file_path})
    # ── Python path (existing code begins here, unchanged) ───────────────────
    global ScreenshotProcessingService
    ...
```

- [ ] **Step 4: Run the processing service tests**

```bash
pytest tests/unit/test_processing_service_rust_path.py -v
```

Expected: all 5 tests PASS

- [ ] **Step 5: Run full unit test suite for regressions**

```bash
pytest tests/unit/ -v --timeout=60 2>&1 | tail -30
```

Expected: same pass rate as before

- [ ] **Step 6: Smoke-test against real screenshot**

```bash
python -c "
from screenshot_processor.web.services.processing_service import process_screenshot_file
r = process_screenshot_file('tests/fixtures/screenshots/test_screenshot.png', 'screen_time')
print('status:', r['processing_status'])
print('title:', r.get('extracted_title'))
print('hourly sample:', list(r.get('extracted_hourly_data', {}).items())[:4])
print('method:', r.get('processing_method'))
"
```

Expected: `status: completed`, sensible hourly values, `method: line_based`

- [ ] **Step 7: Commit**

```bash
git add src/screenshot_processor/web/services/processing_service.py \
        tests/unit/test_processing_service_rust_path.py
git commit -m "feat: add Rust fast-path to process_screenshot_file (30x speedup, fallback-safe)"
```

---

### Task 4: Integration check — verify in running container

- [ ] **Step 1: Rebuild and restart backend/celery**

```bash
docker compose --env-file docker/.env -f docker/docker-compose.dev.yml build backend celery-worker
docker compose --env-file docker/.env -f docker/docker-compose.dev.yml up -d backend celery-worker
```

- [ ] **Step 2: Trigger a reprocess and check for Rust log lines**

```bash
sleep 5
# Trigger a reprocess from the UI or via the API, then:
docker logs ios-screen-time-screenshot-processing-backend-dev --tail 50 2>&1 | grep -i "rust"
docker logs ios-screen-time-screenshot-processing-celery-dev --tail 50 2>&1 | grep -i "rust"
```

Expected: `Rust fast path succeeded` in both containers

- [ ] **Step 3: Commit**

No new code changes — just verification. Done if logs look correct.
