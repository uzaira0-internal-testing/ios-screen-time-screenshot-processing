# API Consistency Review

**Date:** 2025-12-10
**Reviewer:** Claude Code
**Scope:** Backend schemas, frontend models, API client, and type alignment

---

## Executive Summary

This review examines the consistency between backend Pydantic schemas and frontend TypeScript models, API endpoint naming conventions, and request/response type alignment. Several inconsistencies were identified that could lead to runtime errors or confusion.

---

## Findings

### 1. Field Naming Convention Mismatch

**Severity:** Medium
**Location:** Backend uses `snake_case`, frontend uses mixed conventions

**Issue:**
The backend consistently uses `snake_case` for all field names (Pydantic schemas), but the frontend has inconsistent naming in the manual model definitions:

**Backend (`schemas.py`):**
```python
class ScreenshotRead(ScreenshotBase):
    current_annotation_count: int
    has_consensus: bool | None
    grid_upper_left_x: int | None
    verified_by_user_ids: list[int] | None
```

**Frontend (`models/index.ts`):**
```typescript
interface Screenshot {
    current_annotation_count: number;  // Matches
    has_consensus: boolean | null;      // Matches
    grid_upper_left_x: number | null;   // Matches
    verified_by_user_ids: number[] | null; // Matches
}
```

The manual models in `models/index.ts` correctly use `snake_case` to match the backend, which is good. However, this creates a disconnect with typical TypeScript conventions (`camelCase`).

**Recommendation:** Consider using a transformer in the API client to convert between `snake_case` (API) and `camelCase` (frontend), or document this convention explicitly.

---

### 2. Annotation Model Field Inconsistencies

**Severity:** High
**Location:** `frontend/src/core/models/index.ts` vs `schemas.py`

**Issue:**
The `Annotation` interface has redundant/inconsistent fields:

**Frontend:**
```typescript
export interface Annotation {
  id: number;
  screenshot_id: number;
  annotator_id: number;        // Non-existent in backend
  user_id?: number;            // Optional, but required in backend
  annotator_username?: string; // Non-existent in backend
  grid_coords?: GridCoordinates;  // Different structure
  grid_upper_left?: { x: number; y: number };
  grid_lower_right?: { x: number; y: number };
  hourly_data?: HourlyData;    // Backend uses "hourly_values"
  hourly_values?: HourlyData;  // Correct field name
  total_minutes?: number;      // Non-existent in backend
  notes?: string;
  status?: string;
  created_at: string;
  updated_at: string;
}
```

**Backend:**
```python
class AnnotationRead(AnnotationBase):
    id: int
    screenshot_id: int
    user_id: int               # Required, not annotator_id
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
```

**Problems:**
1. `annotator_id` vs `user_id` - Frontend defines both, backend only has `user_id`
2. `hourly_data` vs `hourly_values` - Frontend defines both, backend only uses `hourly_values`
3. `annotator_username` - Doesn't exist in backend response
4. `total_minutes` - Doesn't exist in backend response
5. `grid_coords` vs separate `grid_upper_left`/`grid_lower_right` - Structure mismatch

**Recommendation:** Remove legacy fields (`annotator_id`, `hourly_data`, `annotator_username`, `total_minutes`, `grid_coords`) from the frontend interface and use the auto-generated types from OpenAPI schema.

---

### 3. Consensus Model Mismatch

**Severity:** Medium
**Location:** `frontend/src/core/models/index.ts` vs `schemas.py`

**Issue:**
The frontend `Consensus` interface doesn't match the backend `ConsensusAnalysis` schema:

**Frontend:**
```typescript
export interface Consensus {
  screenshot_id: number;
  total_annotations: number;
  consensus_data: HourlyData;           // Backend uses "consensus_hourly_values"
  disagreements: {
    hour: number;                       // Backend uses string "hour"
    values: {
      annotator_id: number;             // Non-existent in backend
      annotator_username: string;       // Non-existent in backend
      value: number;
    }[];
    consensus_value: number;            // Non-existent - use "median"
  }[];
  agreement_percentage: number;         // Non-existent in backend
}
```

**Backend:**
```python
class ConsensusAnalysis(BaseModel):
    screenshot_id: int
    has_consensus: bool
    total_annotations: int
    disagreements: list[DisagreementDetail]
    consensus_hourly_values: dict[str, float] | None
    calculated_at: datetime.datetime

class DisagreementDetail(BaseModel):
    hour: str                           # String, not number
    values: list[float]                 # Simple list, not objects
    median: float
    has_disagreement: bool
    max_difference: float
```

**Recommendation:** Update the `Consensus` interface to match `ConsensusAnalysis`, or preferably use auto-generated types.

---

### 4. Missing Fields in Frontend Models

**Severity:** Medium
**Location:** `frontend/src/core/models/index.ts`

**Issue:**
Several backend fields are missing from frontend types:

**Screenshot missing:**
- `screenshot_date: date | None` (backend has it, frontend doesn't)

**ScreenshotUploadRequest missing:**
- `screenshot_date?: string` (backend accepts this field)

**Recommendation:** Add missing fields to frontend models or regenerate types from OpenAPI.

---

### 5. Duplicate Stats Endpoint Confusion

**Severity:** Low
**Location:** `screenshots.py`

**Issue:**
There are TWO `/stats` endpoints defined in the same router:

```python
@router.get("/stats", response_model=StatsResponse, tags=["Stats"])
async def get_stats(db: DatabaseSession, current_user: CurrentUser):
    # First implementation (lines 93-140)

@router.get("/stats", response_model=StatsResponse)
async def get_screenshot_stats(db: DatabaseSession, current_user: CurrentUser):
    # Second implementation (lines 278-330)
```

The second registration overrides the first. This creates:
1. Dead code (first implementation never runs)
2. Different behavior (second returns more fields like `auto_processed`, `pending`, `failed`, `skipped`)

**Recommendation:** Remove the duplicate endpoint. Keep only one implementation that returns all required fields.

---

### 6. OpenAPI Schema vs Manual Types

**Severity:** Low
**Location:** Project architecture

**Issue:**
The project has TWO parallel type systems:
1. Auto-generated types in `frontend/src/types/api-schema.ts` (from OpenAPI)
2. Manual types in `frontend/src/core/models/index.ts`

The `apiClient.ts` uses the auto-generated types (correct), but many components still import from `models/index.ts`. This leads to:
- Type mismatches at runtime
- Maintenance burden (updating both)
- Confusion about which to use

**Recommendation:** 
1. Deprecate `models/index.ts` 
2. Export type aliases from `api-schema.ts` with cleaner names
3. Migrate all imports to use OpenAPI-generated types

---

### 7. ReprocessRequest Missing `processing_method`

**Severity:** Medium
**Location:** `frontend/src/core/models/index.ts`

**Issue:**
The frontend `ReprocessRequest` interface is missing the `processing_method` field:

**Frontend:**
```typescript
export interface ReprocessRequest {
  grid_upper_left_x?: number;
  grid_upper_left_y?: number;
  grid_lower_right_x?: number;
  grid_lower_right_y?: number;
  // Missing: processing_method
}
```

**Backend:**
```python
class ReprocessRequest(BaseModel):
    grid_upper_left_x: int | None = None
    grid_upper_left_y: int | None = None
    grid_lower_right_x: int | None = None
    grid_lower_right_y: int | None = None
    processing_method: str | None = Field(
        None,
        pattern="^(ocr_anchored|line_based)$",
    )
```

However, `apiClient.ts` correctly includes this in the function signature:
```typescript
async reprocess(id: number, options?: {
    // ...
    processing_method?: "ocr_anchored" | "line_based";
})
```

**Recommendation:** Update `ReprocessRequest` in `models/index.ts` or remove manual type in favor of generated types.

---

### 8. User Model: `is_admin` vs `role`

**Severity:** Low
**Location:** `frontend/src/core/models/index.ts`

**Issue:**
Frontend defines both `is_admin` and `role`:

**Frontend:**
```typescript
export interface User {
  id: number;
  username: string;
  email: string | null;
  is_active: boolean;
  is_admin: boolean;    // Non-existent in backend
  role: string;
  created_at: string;
}
```

**Backend:**
```python
class UserRead(UserBase):
    id: int
    email: str | None = None
    role: str           # "admin" or "annotator"
    is_active: bool
    created_at: datetime.datetime
    # No is_admin field - check role == "admin" instead
```

**Recommendation:** Remove `is_admin` from frontend type. Use `role === "admin"` checks instead.

---

### 9. API Client Inconsistent Error Handling

**Severity:** Medium
**Location:** `frontend/src/services/apiClient.ts`

**Issue:**
Error handling throws generic messages without error details:

```typescript
async login(username: string) {
    const { data, error } = await apiClient.POST("/api/v1/auth/login", {...});
    if (error) throw new Error("Login failed");  // Loses error.detail
    return data;
}
```

The backend returns structured error responses:
```python
raise HTTPException(status_code=404, detail="Screenshot not found")
```

But the frontend discards this information.

**Recommendation:** Propagate error details:
```typescript
if (error) throw new Error(error.detail || "Login failed");
```

---

### 10. Date Handling Inconsistency

**Severity:** Low
**Location:** Multiple files

**Issue:**
Dates are handled inconsistently:
- Backend uses `datetime.datetime` and `datetime.date` types
- Frontend uses `string` for all date fields

There's no explicit date parsing or formatting, leading to potential timezone issues.

**Recommendation:** 
1. Document that all dates are ISO 8601 strings
2. Add date parsing utilities for display
3. Consider using a date library (date-fns) consistently

---

## Summary

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | Field naming conventions | Medium | Low |
| 2 | Annotation model mismatch | High | Medium |
| 3 | Consensus model mismatch | Medium | Medium |
| 4 | Missing screenshot_date | Medium | Low |
| 5 | Duplicate /stats endpoint | Low | Low |
| 6 | Dual type systems | Low | High |
| 7 | ReprocessRequest incomplete | Medium | Low |
| 8 | is_admin redundancy | Low | Low |
| 9 | Error handling | Medium | Low |
| 10 | Date handling | Low | Medium |

---

## Priority Recommendations

### Immediate (High Impact, Low Effort)
1. Remove duplicate `/stats` endpoint from `screenshots.py`
2. Add `processing_method` to `ReprocessRequest` in `models/index.ts`
3. Remove `is_admin` from `User` interface
4. Improve error handling in API client to preserve error details

### Short-term
1. Align `Annotation` interface with `AnnotationRead` schema
2. Align `Consensus` interface with `ConsensusAnalysis` schema
3. Add `screenshot_date` to frontend `Screenshot` and `ScreenshotUploadRequest`

### Long-term
1. Migrate from manual `models/index.ts` to auto-generated OpenAPI types exclusively
2. Implement camelCase transformation layer if desired
3. Add proper date handling utilities
