# Backend Refactoring Analysis

**Date:** 2025-12-31
**Scope:** `src/screenshot_processor/core/` and `src/screenshot_processor/web/`
**Previous Refactoring:** `processing_service.py` reduced from 720 lines to 253 lines

---

## Executive Summary

The codebase demonstrates strong patterns in some areas (repository pattern in `screenshot_repository.py`, interface-based DI in `core/interfaces.py`, factory pattern in `ocr_factory.py`) but has significant inconsistencies. The primary issues are:

1. **Dual configuration systems** - `core/config.py` (dataclasses) vs `web/config.py` (Pydantic Settings)
2. **Business logic in route handlers** - Screenshots routes have 700+ lines with complex DB operations
3. **Incomplete repository adoption** - Repository pattern exists but only covers ~30% of screenshot operations
4. **Missing DI for OCR engines** - Module-level caching with `lru_cache` instead of proper injection
5. **Scattered processing logic** - Grid detection and bar extraction logic spread across multiple files

**Priority Recommendations:**
1. Extract screenshot route business logic into `ScreenshotService` (High impact, Medium effort)
2. Unify configuration under Pydantic Settings (Medium impact, Low effort)
3. Complete repository pattern adoption for annotations and consensus (Medium impact, Medium effort)
4. Introduce OCR engine dependency injection (Medium impact, Medium effort)

---

## High Priority Refactoring

### 1. Screenshots Route Needs Service Layer Extraction

- **Location:** `src/screenshot_processor/web/api/routes/screenshots.py` (700+ lines)
- **Problem:** Route handlers contain complex business logic, database operations, and validation that should be in a service layer. The file handles:
  - Screenshot CRUD operations
  - Navigation logic (next/prev with filtering)
  - Verification workflow
  - Soft delete/restore operations
  - Processing status management
  - Group statistics

  This violates separation of concerns and makes testing difficult. For comparison, `processing_service.py` was successfully refactored from 720 lines to 253 lines by extracting business logic.

- **Proposed Solution:**
  1. Create `ScreenshotService` class in `web/services/screenshot_service.py`
  2. Move these functions into the service:
     - `get_next_screenshot()` - Navigation logic
     - `navigate_screenshots()` - Filtered navigation
     - `verify_screenshot()` - Verification workflow
     - `soft_delete_screenshot()` / `restore_screenshot()` - State management
  3. Route handlers become thin wrappers that:
     - Parse request parameters
     - Call service methods
     - Return responses
  4. Pattern to follow: `processing_service.py` with its `process_screenshot_sync()` core function

- **Effort:** High (4-6 hours)
- **Impact:** High - Improves testability, maintainability, and follows established pattern

### 2. Dual Configuration Systems Need Unification

- **Location:**
  - `src/screenshot_processor/core/config.py` (lines 1-121) - Uses dataclasses
  - `src/screenshot_processor/web/config.py` (lines 1-145) - Uses Pydantic Settings

- **Problem:** Two different configuration patterns create confusion:
  - Core module uses `@dataclass` with manual env var reading in `get_hybrid_ocr_config()`
  - Web module uses `pydantic-settings` with proper validation and `.env` loading
  - OCR URLs are hardcoded in core config but should come from environment
  - `get_settings()` singleton pattern in web, `lru_cache` pattern in core

- **Proposed Solution:**
  1. Add OCR settings to `web/config.py` Settings class:
     ```python
     # In Settings class
     OCR_ENGINE_TYPE: str = Field(default="hybrid")
     HUNYUAN_OCR_URL: str = Field(default="http://cnrc-rtx4090.ad.bcm.edu:8080")
     PADDLEOCR_URL: str = Field(default="http://cnrc-rtx4090.ad.bcm.edu:8081")
     HUNYUAN_TIMEOUT: int = Field(default=120)
     PADDLEOCR_TIMEOUT: int = Field(default=60)
     ```
  2. Create adapter function in core that reads from web settings:
     ```python
     # In core/config.py
     def get_ocr_config_from_settings() -> OCRConfig:
         from ..web.config import get_settings
         settings = get_settings()
         return OCRConfig(
             use_hybrid=settings.OCR_ENGINE_TYPE == "hybrid",
             hunyuan_url=settings.HUNYUAN_OCR_URL,
             ...
         )
     ```
  3. Deprecate direct env var reading in `get_hybrid_ocr_config()`

- **Effort:** Low (1-2 hours)
- **Impact:** Medium - Eliminates configuration drift, enables validation

### 3. Admin Route Needs Business Logic Extraction

- **Location:** `src/screenshot_processor/web/api/routes/admin.py` (450+ lines)
- **Problem:** Contains complex operations that mix route handling with:
  - User statistics aggregation (lines 50-110)
  - Group deletion with cascade logic (lines 130-180)
  - Test data reset (lines 200-280)
  - Dispute resolution workflow (lines 300-400)
  - Verification tier calculations (lines 400-500)

- **Proposed Solution:**
  1. Create `AdminService` class in `web/services/admin_service.py`
  2. Extract dispute resolution into `DisputeResolutionService`
  3. Extract verification tier logic into `VerificationService`
  4. Route handlers become orchestrators only

- **Effort:** Medium (3-4 hours)
- **Impact:** High - Admin operations are complex and need unit testing

---

## Medium Priority Improvements

### 4. Incomplete Repository Pattern Adoption

- **Location:**
  - `src/screenshot_processor/web/repositories/screenshot_repository.py` (454 lines) - EXISTS
  - Missing: `annotation_repository.py`, `consensus_repository.py`, `user_repository.py`

- **Problem:** Repository pattern was started for screenshots but:
  - Routes still have direct SQLAlchemy queries for annotations
  - Consensus calculations happen in route handlers
  - User operations are scattered across multiple files
  - The existing `ScreenshotRepository` isn't used in all screenshot routes

- **Proposed Solution:**
  1. Create `AnnotationRepository` with methods:
     - `create_annotation()`, `update_annotation()`, `get_by_user_and_screenshot()`
     - `get_with_issues()`, `list_by_screenshot()`
  2. Create `ConsensusRepository` with methods:
     - `calculate_consensus()`, `get_result()`, `update_result()`
  3. Update routes to use repositories via dependency injection
  4. Complete migration of `ScreenshotRepository` usage in `screenshots.py`

- **Effort:** Medium (4-5 hours)
- **Impact:** Medium - Improves testability, centralizes data access

### 5. Processing Pipeline Scattered Across Files

- **Location:**
  - `src/screenshot_processor/core/image_processor.py` (1163 lines)
  - `src/screenshot_processor/core/screenshot_processing.py` (157 lines)
  - `src/screenshot_processor/core/grid_detectors.py` (239 lines)
  - `src/screenshot_processor/web/services/processing_service.py` (253 lines)

- **Problem:** Processing logic is fragmented:
  - `image_processor.py` is a monolith with:
    - Image loading/preprocessing (lines 141-180)
    - Grid anchor detection via OCR (lines 330-380)
    - ROI calculation (lines 522-559)
    - Bar extraction/slicing (lines 744-842)
    - Alignment scoring (lines 844-1002)
    - Left/right anchor finding (lines 1005-1163)
  - `screenshot_processing.py` wraps some of this but doesn't provide clean abstraction
  - Grid detection has its own file but still imports back into image_processor

- **Proposed Solution:**
  1. Split `image_processor.py` into focused modules:
     - `preprocessing.py` - Dark mode conversion, contrast adjustment
     - `bar_extraction.py` - `slice_image()` and supporting functions
     - `alignment.py` - `compute_bar_alignment_score()` and validation
     - Keep `image_processor.py` as facade importing from these
  2. Update `screenshot_processing.py` to use `IGridDetector` interface consistently
  3. Create `IBarExtractor` interface for bar extraction

- **Effort:** High (6-8 hours)
- **Impact:** Medium - Improves maintainability but doesn't add new capabilities

### 6. Sync/Async Boundary Unclear in Services

- **Location:**
  - `src/screenshot_processor/web/services/processing_service.py` - Uses `run_in_executor()`
  - `src/screenshot_processor/web/services/consensus_service.py` - Pure sync with DB session
  - `src/screenshot_processor/web/services/queue_service.py` - Async with ORM

- **Problem:** Inconsistent patterns for handling sync/async:
  - `processing_service.py` correctly wraps sync image processing with `run_in_executor()`
  - `consensus_service.py` mixes sync calculations with async DB access
  - No clear convention for when to use sync vs async

- **Proposed Solution:**
  1. Document sync/async conventions in CLAUDE.md
  2. Establish pattern:
     - Pure calculations: Sync functions
     - DB operations: Async functions
     - CPU-bound work: Wrapped with `run_in_executor()`
  3. Apply pattern to `consensus_service.py`:
     ```python
     # Sync calculation
     def calculate_consensus(annotations: list[dict]) -> ConsensusResult: ...

     # Async DB wrapper
     async def get_or_calculate_consensus(db: AsyncSession, screenshot_id: int) -> ConsensusResult:
         annotations = await self._get_annotations(db, screenshot_id)
         return await asyncio.get_event_loop().run_in_executor(
             None, calculate_consensus, annotations
         )
     ```

- **Effort:** Low (2 hours)
- **Impact:** Medium - Clarifies patterns for future development

---

## DI Pattern Opportunities

### 7. OCR Engine Needs Proper DI (Currently Using Module-Level Cache)

- **Location:**
  - `src/screenshot_processor/core/image_processor.py` (lines 38-102)
  - `src/screenshot_processor/core/ocr_factory.py` (entire file)

- **Problem:** OCR engine instantiation uses `@lru_cache(maxsize=1)` singleton pattern:
  ```python
  @lru_cache(maxsize=1)
  def _get_hybrid_engine(...) -> HybridOCREngine:
      ...
  ```
  This makes testing difficult:
  - Can't inject mock engines
  - Can't test with different configurations
  - Cache persists across tests
  - No way to reset engine state

- **Proposed Solution:**
  1. Create `IOCREngineProvider` protocol:
     ```python
     class IOCREngineProvider(Protocol):
         def get_engine(self) -> IOCREngine: ...
     ```
  2. Create default implementation using factory:
     ```python
     class DefaultOCREngineProvider:
         def __init__(self, engine_type: str, **config):
             self._engine = OCREngineFactory.create_engine(engine_type, **config)
         def get_engine(self) -> IOCREngine:
             return self._engine
     ```
  3. Inject provider into `ScreenshotProcessor`:
     ```python
     class ScreenshotProcessor:
         def __init__(self, ocr_provider: IOCREngineProvider): ...
     ```
  4. Use FastAPI `Depends()` for injection in routes

- **Effort:** Medium (3-4 hours)
- **Impact:** Medium - Enables proper unit testing of OCR-dependent code

### 8. Database Session Injection Needs Repository Layer

- **Location:** All route files use `db: AsyncSession = Depends(get_db)`
- **Problem:** Routes receive raw session and construct queries directly. This:
  - Tightly couples routes to SQLAlchemy
  - Makes it hard to mock database access
  - Leads to query duplication across routes

- **Proposed Solution:** Already have `ScreenshotRepository` - extend pattern:
  1. Create repository factory:
     ```python
     def get_screenshot_repo(db: AsyncSession = Depends(get_db)) -> ScreenshotRepository:
         return ScreenshotRepository(db)

     ScreenshotRepo = Annotated[ScreenshotRepository, Depends(get_screenshot_repo)]
     ```
  2. Update routes to use typed dependency:
     ```python
     @router.get("/{id}")
     async def get_screenshot(id: int, repo: ScreenshotRepo) -> ScreenshotRead:
         screenshot = await repo.get_by_id(id)
         ...
     ```
  3. Apply pattern to new repositories (Annotation, Consensus, User)

- **Effort:** Low (1-2 hours for pattern, plus repository creation)
- **Impact:** Medium - Improves testability and follows existing pattern

---

## Consolidation Opportunities

### 9. Duplicate Issue Type Definitions

- **Location:**
  - `src/screenshot_processor/web/database/schemas.py` (lines 38-45) - Literal type
  - `src/screenshot_processor/web/database/models.py` - Implicit via string column
  - `src/screenshot_processor/web/services/processing_service.py` - String literals

- **Problem:** Issue types defined in multiple places:
  ```python
  # schemas.py
  IssueType = Literal["grid_detection_failed", "ocr_extraction_failed", ...]

  # processing_service.py (implicit)
  ProcessingIssue(issue_type="grid_detection_failed", ...)
  ```
  No shared enum or constant, leading to potential drift.

- **Proposed Solution:**
  1. Create `IssueType` StrEnum in `models.py`:
     ```python
     class IssueType(str, Enum):
         GRID_DETECTION_FAILED = "grid_detection_failed"
         OCR_EXTRACTION_FAILED = "ocr_extraction_failed"
         ...
     ```
  2. Use enum in schemas and services
  3. Add validation to ensure consistency

- **Effort:** Low (1 hour)
- **Impact:** Low - Prevents bugs from typos

### 10. Status Enums Duplicated Between Models and Schemas

- **Location:**
  - `src/screenshot_processor/web/database/models.py` (lines 12-59) - SQLAlchemy Enums
  - `src/screenshot_processor/web/database/schemas.py` (lines 30-37) - Literal types

- **Problem:** Status values defined twice:
  ```python
  # models.py
  class ProcessingStatus(str, Enum):
      PENDING = "pending"
      ...

  # schemas.py
  ProcessingStatus = Literal["pending", "processing", "completed", ...]
  ```
  The comment in schemas.py acknowledges this: "IMPORTANT: These must match the Enum values in models.py exactly"

- **Proposed Solution:**
  1. Export model enums from `database/__init__.py`
  2. In schemas, import and use model enums:
     ```python
     from .models import ProcessingStatus as ProcessingStatusEnum
     # Use ProcessingStatusEnum.PENDING.value in Pydantic models
     ```
  3. Or use Pydantic's enum support directly with model enums

- **Effort:** Low (1 hour)
- **Impact:** Low - Eliminates sync burden, prevents drift

---

## Recommended Refactoring Order

Based on dependencies and impact/effort ratio:

### Phase 1: Foundation (Week 1)
1. **Unify Configuration** (#2) - Low effort, enables other changes
2. **Complete Repository Pattern** (#4) - Establishes pattern for service extraction

### Phase 2: Service Layer (Week 2)
3. **Extract ScreenshotService** (#1) - Highest impact refactoring
4. **Extract AdminService** (#3) - Follows same pattern as #1

### Phase 3: DI and Testability (Week 3)
5. **OCR Engine DI** (#7) - Enables proper testing
6. **Repository Injection** (#8) - Completes DI pattern

### Phase 4: Cleanup (Week 4)
7. **Split image_processor.py** (#5) - Large but low risk
8. **Consolidate Enums** (#9, #10) - Quick wins
9. **Document Sync/Async Patterns** (#6) - Guides future development

---

## Files Examined

### Services (4 files)
- `web/services/processing_service.py` - 253 lines (recently refactored)
- `web/services/queue_service.py` - 156 lines
- `web/services/consensus_service.py` - 189 lines
- `web/services/auth_service.py` - 45 lines

### Routes (7 files)
- `web/api/routes/screenshots.py` - 700+ lines (NEEDS REFACTORING)
- `web/api/routes/admin.py` - 450+ lines (NEEDS REFACTORING)
- `web/api/routes/annotations.py` - 180 lines
- `web/api/routes/consensus.py` - 95 lines
- `web/api/routes/auth.py` - 42 lines
- `web/api/routes/preprocessing.py` - 85 lines
- `web/api/routes/websocket.py` - 55 lines

### Core Processing (8 files)
- `core/image_processor.py` - 1163 lines (NEEDS SPLIT)
- `core/screenshot_processing.py` - 157 lines
- `core/grid_detectors.py` - 239 lines
- `core/ocr.py` - 450+ lines
- `core/ocr_factory.py` - 285 lines
- `core/config.py` - 121 lines
- `core/interfaces.py` - 200+ lines (GOOD PATTERNS)

### OCR Engines (5 files)
- `core/ocr_engines/hybrid_engine.py` - 421 lines
- `core/ocr_engines/hunyuan_engine.py` - ~150 lines
- `core/ocr_engines/paddleocr_remote_engine.py` - ~120 lines
- `core/ocr_engines/tesseract_engine.py` - ~100 lines
- `core/ocr_engines/paddleocr_engine.py` - ~150 lines

### Database (4 files)
- `web/database/models.py` - 283 lines
- `web/database/schemas.py` - 927 lines
- `web/repositories/screenshot_repository.py` - 454 lines (GOOD PATTERN)
- `web/config.py` - 145 lines

---

## Success Metrics

After completing these refactorings:
1. Route handlers should be under 100 lines each (currently 700+ for screenshots)
2. All database queries should go through repositories
3. OCR engines should be injectable/mockable in tests
4. Configuration should come from single source (Pydantic Settings)
5. Each module should have single responsibility

---

## References

- Previous refactoring success: `processing_service.py` (720 -> 253 lines)
- Existing good patterns: `ScreenshotRepository`, `IGridDetector`, `OCREngineFactory`
- CLAUDE.md architecture guidelines
