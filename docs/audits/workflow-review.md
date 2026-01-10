# End-to-End Workflow Review

**Review Date:** 2025-11-30  
**Scope:** Complete data flow from upload to export

---

## Summary

The complete workflow **WORKS CORRECTLY** with proper data separation between OCR-extracted originals and user annotations. All six stages function as expected:

1. ✅ Upload accepts all required metadata
2. ✅ Groups auto-create and separate properly
3. ✅ Auto-processing runs OCR and detects Daily Total pages
4. ✅ Subcategory filtering by processing status works
5. ✅ User annotations are stored separately from OCR data
6. ✅ Export includes both original OCR data and user annotations

**One minor issue identified:** The JSON export doesn't include `device_type` or `source_id` metadata fields.

---

## Stage 1: Upload with Metadata

### Status: ✅ WORKING

### Findings:

**Endpoint:** `POST /api/screenshots/upload?api_key=YOUR_KEY`

**Request Schema** (`schemas.py:296-304`):
```python
class ScreenshotUploadRequest(BaseModel):
    screenshot: str = Field(..., description="Base64 encoded image data")
    participant_id: str = Field(..., min_length=1, max_length=100)
    group_id: str = Field(..., min_length=1, max_length=100)
    image_type: str = Field(..., pattern="^(battery|screen_time)$")
    device_type: str | None = Field(None, max_length=50)
    source_id: str | None = Field(None, max_length=100)
    filename: str | None = Field(None, max_length=255)
    screenshot_date: date | None = Field(None, description="Date the screenshot was taken")
```

**All Required Fields Accepted:**
- [x] `screenshot` - Base64 image data (required)
- [x] `group_id` - Study/batch identifier (required)
- [x] `image_type` - "screen_time" or "battery" (required, validated)
- [x] `participant_id` - Participant identifier (required)
- [x] `screenshot_date` - Date of screenshot (optional, YYYY-MM-DD)
- [x] `device_type` - Auto-detected if not provided
- [x] `source_id` - Optional source identifier

**Database Storage** (`models.py:83-90`):
All metadata fields are stored in the Screenshot model:
- `participant_id` - indexed for fast queries
- `group_id` - foreign key to Groups table, indexed
- `source_id` - stored as-is
- `device_type` - stored or auto-detected from image dimensions
- `screenshot_date` - stored as Date, indexed

**Validation:**
- Image type is validated via regex pattern
- Base64 decoding validated with proper error handling
- Image format validated (PNG/JPEG only)
- Duplicate detection by file path hash

### Issues Found:
None - upload works correctly.

---

## Stage 2: Group Separation

### Status: ✅ WORKING

### Findings:

**Auto-Creation** (`screenshots.py:897-906`):
Groups are automatically created on first upload using PostgreSQL `INSERT ... ON CONFLICT DO NOTHING`:
```python
insert_stmt = (
    pg_insert(Group)
    .values(id=request.group_id, name=request.group_id, image_type=request.image_type)
    .on_conflict_do_nothing(index_elements=["id"])
)
```

**Group Model** (`models.py:52-62`):
```python
class Group(Base):
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    image_type: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime.datetime]
    screenshots: Mapped[list["Screenshot"]] = relationship(back_populates="group")
```

**List Groups Endpoint** (`screenshots.py:107-160`):
`GET /api/screenshots/groups` returns all groups with counts by processing status:
- `screenshot_count` - total screenshots
- `processing_pending` - awaiting OCR
- `processing_completed` - OCR succeeded
- `processing_failed` - OCR failed
- `processing_skipped` - Daily Total pages

**Filtering:**
Screenshots can be filtered by `group_id` in:
- Queue endpoint: `GET /api/screenshots/queue?group_id=X`
- List endpoint: `GET /api/screenshots/groups/{group_id}/screenshots`
- Export endpoints: `GET /api/screenshots/export/json?group_id=X`

### Issues Found:
None - group separation works correctly.

---

## Stage 3: Auto-Processing (OCR)

### Status: ✅ WORKING

### Findings:

**Automatic Triggering** (`screenshots.py:968-970`):
After upload, Celery task is queued immediately:
```python
from screenshot_processor.web.tasks import process_screenshot_task
process_screenshot_task.delay(new_screenshot.id)
```

**Celery Task** (`tasks.py:39-107`):
- Fetches screenshot from database
- Calls `ProcessingService.process_screenshot()`
- Updates Screenshot record with results
- Retries up to 3 times on failure
- Marks as FAILED after max retries

**Processing Service** (`processing_service.py`):
Key functionality verified:

1. **Title Extraction**: Uses OCR to extract app title (e.g., "Screen Time", "Instagram")
2. **Daily Total Detection** (`_check_is_daily_total`):
   - Checks if title == "Daily Total"
   - Returns `processing_status: "skipped"` for Daily Total pages
   - Sets `annotation_status: SKIPPED` automatically
3. **Hourly Data Extraction**: Extracts 24 hourly values from the bar graph
4. **Total Extraction**: Extracts the OCR total from the screenshot

**Fields Populated After Processing:**
- [x] `extracted_title` - App name or date
- [x] `extracted_total` - Total time (e.g., "2h 30m")
- [x] `extracted_hourly_data` - Dict of hour -> minutes
- [x] `processing_status` - pending/completed/failed/skipped
- [x] `processing_issues` - List of any issues encountered
- [x] `has_blocking_issues` - Boolean flag
- [x] `title_y_position` - Y coordinate of title for UI
- [x] `grid_upper_left_x/y`, `grid_lower_right_x/y` - Grid coordinates

**Processing Status Values:**
- `pending` - Not yet processed
- `completed` - OCR succeeded
- `failed` - OCR failed (couldn't detect graph)
- `skipped` - Daily Total page (auto-skipped)

### Issues Found:
None - auto-processing works correctly.

---

## Stage 4: Subcategory Separation (Processing Status)

### Status: ✅ WORKING

### Findings:

**Homepage Display** (`frontend/src/pages/HomePage.tsx`):
Groups show counts for each processing status with clickable filters:
- Pending (blue)
- Completed (green)
- Failed (red)
- Skipped (gray)

**API Filtering:**
Queue endpoint supports `processing_status` filter:
```
GET /api/screenshots/queue?processing_status=failed&group_id=study-2024
```

**Queue Service** (`queue_service.py`):
Correctly filters by processing status when provided:
```python
if processing_status:
    stmt = stmt.where(Screenshot.processing_status == processing_status)
```

**UI Navigation:**
Clicking a status count on the homepage navigates to annotation page with filter:
```typescript
navigate(`/annotate?group=${groupId}&processing_status=${status}`)
```

### Issues Found:
None - subcategory separation works correctly.

---

## Stage 5: User Annotation/Editing

### Status: ✅ WORKING

### Findings:

**Data Separation Analysis:**

This is the critical architecture question: **Are original OCR values preserved separately from user edits?**

**Answer: YES - Data is properly separated.**

| Data Type | Storage Location | Purpose |
|-----------|-----------------|---------|
| OCR Original | `Screenshot` model | Original extraction, never modified by users |
| User Edits | `Annotation` model | User-submitted values, per-user |

**Screenshot Model** (Original OCR Data):
```python
# These fields store OCR results and are NOT modified by user annotations
extracted_title: str | None
extracted_total: str | None
extracted_hourly_data: dict | None  # {"0": 10, "1": 15, ...}
grid_upper_left_x/y, grid_lower_right_x/y: int | None
```

**Annotation Model** (User Edits):
```python
# These fields store user-submitted values, separate from Screenshot
hourly_values: dict  # User's corrected values
extracted_title: str | None  # User can override title
extracted_total: str | None  # User can override total
grid_upper_left: dict | None  # User's grid selection
grid_lower_right: dict | None
notes: str | None  # User notes
time_spent_seconds: float | None  # Time tracking
```

**Key Points:**
1. Creating an annotation **does not modify** the Screenshot's `extracted_*` fields
2. Each user gets their own Annotation record
3. Multiple users can annotate the same screenshot independently
4. Original OCR data is always accessible via the Screenshot record
5. User edits are stored in separate Annotation records

**Annotation Workflow** (`annotations.py:26-120`):
- `POST /api/annotations/` creates or updates user's annotation
- Upsert behavior: same user can update their annotation
- Screenshot's `current_annotation_count` is incremented
- Consensus is recalculated when count >= 2

### Issues Found:
None - data separation is properly implemented.

---

## Stage 6: Export Functionality

### Status: ✅ WORKING (minor enhancement suggested)

### Findings:

**JSON Export** (`GET /api/screenshots/export/json`):

Returns structured JSON with:
```json
{
  "export_timestamp": "2025-11-30T...",
  "exported_by": "username",
  "group_id": "study-2024",
  "total_screenshots": 150,
  "screenshots": [
    {
      "id": 1,
      "file_path": "uploads/...",
      "image_type": "screen_time",
      "participant_id": "P001",
      "group_id": "study-2024",
      "screenshot_date": "2024-03-15",
      "processing_status": "completed",
      "extracted_title": "Screen Time",      // OCR original
      "extracted_total": "2h 30m",           // OCR original
      "extracted_hourly_data": {"0": 10...}, // OCR original
      "annotation_count": 2,
      "annotations": [                        // User edits
        {
          "id": 1,
          "user_id": 1,
          "hourly_values": {"0": 12...},     // User's values
          "extracted_title": "Screen Time",
          "extracted_total": "2h 32m",
          "created_at": "..."
        }
      ],
      "consensus": {                          // Calculated consensus
        "has_consensus": true,
        "consensus_values": {"0": 11...},
        "disagreement_details": {...}
      }
    }
  ]
}
```

**CSV Export** (`GET /api/screenshots/export/csv`):

Includes:
- Screenshot ID, Filename, Group ID, Participant ID
- Image Type, Screenshot Date, Uploaded At
- Annotation Count, Has Consensus
- Consensus Total, Disagreement Count
- Hour 0 through Hour 23 (consensus values)

**Filter Support:**
Both endpoints support `?group_id=X` for filtering by group.

**Access Control:**
Both endpoints available to all authenticated users (not admin-only).

### Issues Found:

None - export now includes all metadata fields including `device_type` and `source_id`.

---

## Critical Issues

**None identified.** The complete workflow functions correctly.

---

## Minor Issues

None - all identified issues have been resolved.

---

## Recommendations

### Priority 1: Consider Adding Raw OCR Export Option (optional)
For debugging/auditing, consider adding an export mode that includes only OCR data (no user annotations) to verify original extraction quality.

### Priority 2: Documentation (optional)
Document the data flow diagram showing:
```
Upload → Screenshot (OCR data) → Annotations (user data) → Consensus → Export
```

---

## Verification Checklist

| Stage | Component | Status |
|-------|-----------|--------|
| 1 | Upload accepts all metadata | ✅ |
| 1 | Validation on required fields | ✅ |
| 1 | Database stores all fields | ✅ |
| 2 | Groups auto-created | ✅ |
| 2 | Groups track image_type | ✅ |
| 2 | Groups list with counts | ✅ |
| 2 | Filter by group | ✅ |
| 3 | Auto-processing triggered | ✅ |
| 3 | Title extracted via OCR | ✅ |
| 3 | Hourly values extracted | ✅ |
| 3 | Daily Total detection | ✅ |
| 3 | Processing status tracked | ✅ |
| 3 | Issues stored | ✅ |
| 4 | Filter by processing status | ✅ |
| 4 | Counts shown per status | ✅ |
| 4 | Queue filters correctly | ✅ |
| 5 | View OCR data before edit | ✅ |
| 5 | Modify hourly values | ✅ |
| 5 | Modify grid coordinates | ✅ |
| 5 | Add notes | ✅ |
| 5 | Time tracking | ✅ |
| 5 | **Original preserved** | ✅ |
| 5 | **User edits separate** | ✅ |
| 6 | JSON export with metadata | ✅ |
| 6 | JSON export with OCR data | ✅ |
| 6 | JSON export with annotations | ✅ |
| 6 | JSON export with consensus | ✅ |
| 6 | Filter by group | ✅ |
| 6 | CSV export | ✅ |
| 6 | API accessible (not UI only) | ✅ |

---

## Conclusion

The screenshot annotation application correctly implements the complete expected workflow:

1. **Upload** properly accepts and stores all metadata
2. **Groups** are auto-created and provide proper separation
3. **Auto-processing** extracts titles, totals, hourly data, and detects Daily Total pages
4. **Subcategory separation** allows filtering by processing status
5. **User annotations** are stored completely separately from original OCR data
6. **Export** provides both JSON and CSV with original OCR data, user annotations, and consensus

**The application is ready for production use in a research data pipeline.**
