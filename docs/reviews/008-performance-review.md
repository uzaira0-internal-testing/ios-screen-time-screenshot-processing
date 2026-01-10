# Performance Review - Screenshot Annotator

**Review Date:** 2025-12-10  
**Reviewer:** Claude Code  
**Critical Bottlenecks Found:** 5  
**Optimization Opportunities:** 8

---

## Critical Bottlenecks

### 1. N+1 Query Pattern in Group Listing

**Location:** `src/screenshot_processor/web/api/routes/screenshots.py:148-197`

```python
@router.get("/groups", response_model=list[GroupRead])
async def list_groups(db: DatabaseSession):
    result = await db.execute(select(Group))
    groups = result.scalars().all()
    
    group_reads = []
    for group in groups:
        # 5 separate queries PER GROUP
        total_stmt = select(func.count(...)).where(Screenshot.group_id == group.id)
        pending_stmt = select(func.count(...)).where(...)
        completed_stmt = select(func.count(...)).where(...)
        failed_stmt = select(func.count(...)).where(...)
        skipped_stmt = select(func.count(...)).where(...)
```

**Impact:** With 20 groups, this executes 101 queries (1 + 20*5). For 100 groups: 501 queries.

**Fix - Single Query with Aggregation:**
```python
@router.get("/groups", response_model=list[GroupRead])
async def list_groups(db: DatabaseSession):
    from sqlalchemy import case
    
    stmt = (
        select(
            Group,
            func.count(Screenshot.id).label("total_count"),
            func.count(case((Screenshot.processing_status == ProcessingStatus.PENDING, 1))).label("pending"),
            func.count(case((Screenshot.processing_status == ProcessingStatus.COMPLETED, 1))).label("completed"),
            func.count(case((Screenshot.processing_status == ProcessingStatus.FAILED, 1))).label("failed"),
            func.count(case((Screenshot.processing_status == ProcessingStatus.SKIPPED, 1))).label("skipped"),
        )
        .outerjoin(Screenshot, Screenshot.group_id == Group.id)
        .group_by(Group.id)
    )
    result = await db.execute(stmt)
    # Single query returns all data
```

**Estimated Impact:** 50-100x faster for groups listing.

---

### 2. Double Image Read in Processing

**Location:** `src/screenshot_processor/core/image_processor.py:85-108`

```python
def extract_hourly_data_only(...):
    img = load_and_validate_image(filename)  # First read + conversion
    img = adjust_contrast_brightness(img, ...)
    
    # ... calculations ...
    
    img_copy = cv2.imread(str(filename))  # SECOND read of same file!
    if is_battery:
        img_new = remove_all_but(img_copy, ...)
```

**Impact:** Every reprocess operation reads the same image file twice from disk.

**Fix:**
```python
def extract_hourly_data_only(...):
    img_raw = cv2.imread(str(filename))
    if img_raw is None:
        raise ImageProcessingError("Failed to load image.")
    
    img = convert_dark_mode(img_raw.copy())
    img = adjust_contrast_brightness(img, contrast=2.0, brightness=-220)
    
    # Use img_raw for battery processing (no need to reload)
    if is_battery:
        img_new = remove_all_but(img_raw, np.array([255, 121, 0]))
```

**Estimated Impact:** 30-50% faster for image processing operations.

---

### 3. Duplicate Stats Endpoint

**Location:** `src/screenshot_processor/web/api/routes/screenshots.py`

There are TWO `/stats` endpoints:
- Lines 86-130: First `/stats` implementation
- Lines 324-374: Second `/stats` implementation (different queries!)

**Impact:** Confusion, maintenance burden, and one may be slower than the other.

**Fix:** Remove duplicate, keep the more efficient version.

---

### 4. Image Re-loading on Every Reprocess

**Location:** `src/screenshot_processor/web/services/processing_service.py:280-290`

```python
# Line-based detection
img = cv2.imread(file_path)
# ... detect grid ...

# Then extract hourly data (reads image AGAIN internally)
row = extract_hourly_data_only(file_path, upper_left, lower_right, is_battery)
```

**Impact:** Image read 3-4 times per reprocess operation.

**Fix:** Pass already-loaded image to avoid re-reads:
```python
def extract_hourly_data_only(
    img: np.ndarray,  # Accept pre-loaded image
    upper_left: tuple[int, int],
    lower_right: tuple[int, int],
    is_battery: bool,
) -> list:
```

**Estimated Impact:** 40-60% faster reprocessing.

---

### 5. Missing Database Indexes

**Location:** `src/screenshot_processor/web/database/models.py`

Current indexes are good, but missing some for common queries:

```python
# Missing composite index for common filter combination
# Query: WHERE group_id = ? AND processing_status = ? ORDER BY id
```

**Fix - Add Composite Index:**
```python
from sqlalchemy import Index

class Screenshot(Base):
    __tablename__ = "screenshots"
    __table_args__ = (
        Index('ix_screenshots_group_processing', 'group_id', 'processing_status'),
        Index('ix_screenshots_group_date', 'group_id', 'screenshot_date'),
    )
```

**Impact:** 2-10x faster for filtered queries on large datasets.

---

## High Priority Optimizations

### 6. Export Endpoints Load All Data Into Memory

**Location:** `src/screenshot_processor/web/api/routes/screenshots.py:1100+`

```python
@router.get("/export/json")
async def export_annotations_json(...):
    result = await db.execute(stmt)
    screenshots = result.scalars().all()  # Loads ALL matching screenshots
    
    for screenshot in screenshots:
        # Also loads all annotations per screenshot (N+1)
        annotations_result = await db.execute(
            select(Annotation).where(Annotation.screenshot_id == screenshot.id)
        )
```

**Impact:** Memory exhaustion with large exports. 10k screenshots = OOM risk.

**Fix - Streaming Export:**
```python
from fastapi.responses import StreamingResponse
import json

@router.get("/export/json")
async def export_annotations_json(...):
    async def generate():
        yield '{"screenshots": ['
        first = True
        
        # Use server-side cursor for streaming
        async for screenshot in await db.stream_scalars(stmt):
            if not first:
                yield ','
            first = False
            # Eagerly load annotations with the screenshot
            yield json.dumps(screenshot_to_dict(screenshot))
        
        yield ']}'
    
    return StreamingResponse(generate(), media_type="application/json")
```

---

### 7. Frontend Re-renders on Every Keystroke

**Location:** `frontend/src/components/annotation/AnnotationWorkspace.tsx:165-200`

```typescript
// Auto-save effect triggers on every hourly_data change
useEffect(() => {
  // ... save logic ...
}, [hourlyDataJson, ...]);  // hourlyDataJson changes on every edit
```

**Impact:** Save attempt on every single keystroke/slider move.

**Fix - Debounce the auto-save:**
```typescript
const debouncedSave = useMemo(
  () => debounce(async () => {
    await saveOnly(notes);
    setLastSaved(new Date());
  }, 1000),  // Save max once per second
  [saveOnly, notes]
);

useEffect(() => {
  if (hasChanges) {
    debouncedSave();
  }
  return () => debouncedSave.cancel();
}, [hourlyDataJson, hasChanges, debouncedSave]);
```

---

### 8. Large Screenshot Response Payloads

**Location:** Multiple endpoints return full `ScreenshotRead` when only ID is needed.

```python
# Returns full screenshot object with all 25+ fields
return ScreenshotRead.model_validate(screenshot)
```

**Fix - Create minimal response models:**
```python
class ScreenshotMinimal(BaseModel):
    id: int
    processing_status: str
    
class ScreenshotListItem(BaseModel):
    id: int
    participant_id: str | None
    processing_status: str
    has_blocking_issues: bool
    current_annotation_count: int
```

---

## Medium Priority Optimizations

### 9. Repeated Color Space Conversions

**Location:** `src/screenshot_processor/core/image_processor.py`

```python
img = convert_dark_mode(img)  # Called multiple times
# BGR -> grayscale -> threshold -> back
```

**Fix:** Cache converted images or ensure single conversion path.

---

### 10. OCR Called Multiple Times Per Screenshot

**Location:** `src/screenshot_processor/web/services/processing_service.py`

For screen_time screenshots:
1. `find_screenshot_title()` - OCR for title
2. `find_screenshot_total_usage()` - OCR for total
3. Sometimes called again in `ensure_ocr_total()`

**Fix:** Single OCR pass extracting all fields:
```python
def extract_all_text_fields(img) -> dict:
    """Single OCR pass to extract title, total, and any other text."""
    # Run Tesseract once, parse all results
    pass
```

---

### 11. Connection Pool May Be Undersized

**Location:** `src/screenshot_processor/web/database/database.py:33-37`

```python
pool_size=10,
max_overflow=20,
```

**Issue:** With concurrent Celery workers + API requests, pool may be exhausted.

**Fix:** Make configurable via environment:
```python
pool_size=int(os.getenv("DB_POOL_SIZE", "20")),
max_overflow=int(os.getenv("DB_POOL_OVERFLOW", "30")),
```

---

### 12. Frontend Bundle Size

Not analyzed in detail, but consider:
- Code splitting for annotation workspace
- Lazy loading heavy components (GridSelector, image processing)
- Tree-shaking unused Tailwind classes

---

## Database Query Analysis

### Most Expensive Queries (by frequency × complexity)

| Query | Frequency | Improvement |
|-------|-----------|-------------|
| Group counts (5 per group) | Every group list | Single aggregation query |
| Screenshot navigation | Every navigation | Add composite index |
| Export with annotations | Per export | Eager loading + streaming |
| Stats calculation | Frequent | Cache with Redis (5s TTL) |

### Recommended Indexes

```sql
-- For navigation queries
CREATE INDEX ix_screenshots_group_processing_id 
ON screenshots(group_id, processing_status, id);

-- For date-based filtering
CREATE INDEX ix_screenshots_group_date 
ON screenshots(group_id, screenshot_date);

-- For verification queries
CREATE INDEX ix_screenshots_verified 
ON screenshots((verified_by_user_ids IS NOT NULL));
```

---

## Frontend Performance

### Current Issues

1. **Large component tree** - AnnotationWorkspace renders many child components
2. **No virtualization** - Screenshot list loads all items
3. **Frequent re-renders** - Zustand store updates trigger full re-renders

### Recommendations

1. Use `React.memo()` on child components
2. Implement virtualization for screenshot lists (react-window)
3. Split Zustand store to reduce re-render scope
4. Use `useDeferredValue` for non-critical updates

---

## Summary - Quick Wins

| Issue | Effort | Impact | Priority |
|-------|--------|--------|----------|
| Fix N+1 in groups listing | Low | High | P0 |
| Eliminate double image read | Low | Medium | P0 |
| Add composite indexes | Low | High | P1 |
| Debounce auto-save | Low | Medium | P1 |
| Stream exports | Medium | High | P1 |
| Single OCR pass | Medium | Medium | P2 |
| Remove duplicate stats endpoint | Low | Low | P2 |

---

## Conclusion

The main performance issues are:
1. **N+1 queries** in group listing (easy fix, high impact)
2. **Multiple disk reads** of the same image (easy fix, medium impact)
3. **Missing composite indexes** (easy fix, high impact for scale)

With these fixes, the application should handle 10x more data without issues.
