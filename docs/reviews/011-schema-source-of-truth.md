# Schema Source of Truth Review

## Executive Summary

**Status: GOOD** - The codebase has a well-established single source of truth pattern.

The frontend correctly derives types from the backend via OpenAPI generation (`npm run generate:api-types`). The backend has clear separation between database models, API schemas, and core interfaces.

**Risk Level: LOW** - Minor improvements possible but no critical issues.

---

## Schema Architecture Overview

```
Backend (Source of Truth)
├── models.py (SQLAlchemy) ──────► Database
├── schemas.py (Pydantic) ───────► OpenAPI Spec ──► api-schema.ts (Generated)
└── interfaces.py (Dataclasses) ─► Internal Processing

Frontend (Derived)
├── types/api-schema.ts ◄──────── Generated from OpenAPI
├── types/index.ts ◄───────────── Re-exports + UI-only types
└── core/models/index.ts ◄─────── Deprecated, re-exports from types/
```

---

## Schema Inventory

### Backend Schemas

| Location | Type | Purpose |
|----------|------|---------|
| `models.py:12-28` | Enums | `AnnotationStatus`, `ProcessingStatus`, `ProcessingMethod` |
| `models.py:43-58` | SQLAlchemy | `User` model |
| `models.py:60-71` | SQLAlchemy | `Group` model |
| `models.py:73-139` | SQLAlchemy | `Screenshot` model (main entity) |
| `models.py:142-167` | SQLAlchemy | `Annotation` model |
| `models.py:170-184` | SQLAlchemy | `ProcessingIssue` model |
| `models.py:187-201` | SQLAlchemy | `UserQueueState` model |
| `models.py:204-218` | SQLAlchemy | `ConsensusResult` model |
| `schemas.py:14-34` | Pydantic | Shared types (Point, Literals) |
| `schemas.py:41-67` | Pydantic | ProcessingIssue schemas |
| `schemas.py:73-108` | Pydantic | User schemas |
| `schemas.py:115-164` | Pydantic | Screenshot schemas |
| `schemas.py:176-220` | Pydantic | Annotation schemas |
| `schemas.py:249-281` | Pydantic | Consensus schemas |
| `schemas.py:307-342` | Pydantic | Processing result schemas |
| `interfaces.py:23-28` | StrEnum | `GridDetectionMethod` |
| `interfaces.py:31-71` | Dataclass | `GridBounds` |
| `interfaces.py:74-103` | Dataclass | Processing result dataclasses |

### Frontend Schemas

| Location | Type | Purpose |
|----------|------|---------|
| `types/api-schema.ts` | Generated | ~50 schemas from OpenAPI |
| `types/index.ts:15-86` | Re-exports | Type aliases from generated schema |
| `types/index.ts:92-96` | Literals | Enum-like types (duplicated from backend) |
| `types/index.ts:112-170` | Interfaces | UI-only types not in backend |
| `types/index.ts:181-187` | Legacy | Deprecated aliases |

---

## Duplication Analysis

### 1. Enum Duplication (Minor Issue)

**Backend** `models.py`:
```python
class ProcessingMethod(str, Enum):
    OCR_ANCHORED = "ocr_anchored"
    LINE_BASED = "line_based"
    MANUAL = "manual"
```

**Backend** `interfaces.py`:
```python
class GridDetectionMethod(StrEnum):
    OCR_ANCHORED = "ocr_anchored"
    LINE_BASED = "line_based"
    MANUAL = "manual"
```

**Backend** `schemas.py`:
```python
ProcessingMethod = Literal["ocr_anchored", "line_based", "manual"]
```

**Impact**: Same values defined 3 times. Low risk as they're semantically identical.

**Recommendation**: Use a single source - keep `models.py` enums and import them in `schemas.py`:
```python
# schemas.py
from .models import ProcessingMethod as ProcessingMethodEnum
ProcessingMethod = Literal["ocr_anchored", "line_based", "manual"]  # Or derive from enum
```

### 2. GridBounds Duplication (Minor Issue)

**Backend** `interfaces.py`:
```python
@dataclass
class GridBounds:
    upper_left_x: int
    upper_left_y: int
    lower_right_x: int
    lower_right_y: int
```

**Backend** `schemas.py` uses flat fields in multiple schemas:
```python
grid_upper_left_x: int | None
grid_upper_left_y: int | None
grid_lower_right_x: int | None
grid_lower_right_y: int | None
```

**Impact**: Low - they serve different purposes (internal processing vs API). Current approach is acceptable.

### 3. Frontend UI-Only Types (Acceptable)

The following types exist only in frontend and are NOT in backend:

- `ProcessingProgress` - WASM mode progress tracking
- `Consensus` - UI display format (differs from API `ConsensusAnalysis`)
- `LoginCredentials`, `AuthResponse` - Auth UI helpers
- `ScreenshotListParams`, `NavigationParams` - Query parameter helpers
- `ApiError` - Error handling

**Impact**: Acceptable - these are legitimate UI concerns not needed on backend.

---

## Consistency Check

### Field Name Consistency ✅

| Concept | Backend | Frontend | Status |
|---------|---------|----------|--------|
| Grid coordinates | `grid_upper_left_x` | `grid_upper_left_x` | ✅ Match |
| Hourly values | `hourly_values` | `hourly_values` | ✅ Match |
| Processing status | `processing_status` | `processing_status` | ✅ Match |
| Screenshot date | `screenshot_date` | `screenshot_date` | ✅ Match |

### Type Consistency ✅

| Field | Backend Type | Frontend Type | Status |
|-------|--------------|---------------|--------|
| `hourly_values` | `dict[str, int \| float]` | `Record<string, number>` | ✅ Compatible |
| `processing_status` | Literal | enum string | ✅ Match |
| `created_at` | `datetime` | `string` (ISO) | ✅ Correct |

---

## Recommended Architecture

The current architecture is correct:

```
SQLAlchemy Models (models.py)
       ↓
Pydantic Schemas (schemas.py) ─→ OpenAPI Spec ─→ Generated TypeScript
       ↓
Core Interfaces (interfaces.py) - Internal processing only
```

**No changes needed** - this is the right pattern.

---

## Action Items

### Priority: Low (Tech Debt)

1. **Consolidate Enum Definitions** (Effort: 1 hour)
   - Keep enums in `models.py`
   - Import into `interfaces.py` instead of redefining
   - Use `Literal` types in `schemas.py` derived from enum values

2. **Remove Deprecated `core/models/index.ts`** (Effort: 30 min)
   - Update all imports from `@/core/models` to `@/types`
   - Delete the deprecated file after migration

3. **Document Schema Generation** (Effort: 30 min)
   - Add note to CLAUDE.md about running `npm run generate:api-types`
   - Document when to regenerate (after API changes)

---

## Conclusion

**The schema architecture is well-designed.** The frontend correctly uses OpenAPI-generated types as the source of truth. Minor duplication exists in backend enums but poses no functional risk. No urgent action required.
