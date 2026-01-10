# Code Organization Review

## 1. Architecture Overview

### 1.1 High-Level Structure

```
screenshot-annotator/
├── src/                                 # Python backend
│   └── screenshot_processor/
│       ├── core/                        # Domain logic (no web dependencies)
│       ├── web/                         # FastAPI web application
│       ├── gui/                         # PyQt desktop GUI (legacy)
│       └── cli/                         # CLI tools (minimal)
├── frontend/                            # React TypeScript frontend
│   └── src/
│       ├── components/                  # React components
│       ├── core/                        # DI architecture + implementations
│       ├── hooks/                       # React hooks
│       ├── store/                       # Zustand state management
│       ├── services/                    # API clients
│       └── types/                       # TypeScript types
├── tests/                               # Python tests
├── alembic/                             # Database migrations
└── docker-compose.yml                   # Container orchestration
```

### 1.2 Assessment Summary

| Aspect | Rating | Notes |
|--------|--------|-------|
| Separation of Concerns | Good | Core logic separate from web layer |
| Dependency Direction | Good | Dependencies flow inward (web → core) |
| Module Boundaries | Good | Clear package boundaries |
| Interface Segregation | Excellent | Well-defined interfaces in both BE/FE |
| Testability | Good | DI enables mocking, fixtures are reusable |

---

## 2. Backend Organization

### 2.1 Package Structure

```
src/screenshot_processor/
├── core/                                 # Domain Logic (Pure Python)
│   ├── interfaces.py                    # ABC interfaces (IGridDetector, IBarProcessor)
│   ├── grid_detectors.py                # OCR-anchored detection
│   ├── line_based_detection/            # Line-based detection strategy
│   │   ├── detector.py                  # Main detector class
│   │   ├── protocol.py                  # Detection protocol
│   │   └── strategies/                  # Detection strategies
│   ├── bar_processor.py                 # Bar value extraction
│   ├── ocr.py                           # OCR utilities
│   ├── image_processor.py               # Image processing
│   ├── screenshot_processing.py         # DI-based orchestration
│   └── models.py                        # Core domain models
├── web/                                  # Web Layer
│   ├── api/
│   │   ├── main.py                      # FastAPI app entry
│   │   ├── dependencies.py              # DI dependencies
│   │   ├── v1/                          # Versioned API
│   │   └── routes/                      # Route handlers
│   ├── database/
│   │   ├── models.py                    # SQLAlchemy models
│   │   ├── schemas.py                   # Pydantic schemas
│   │   └── database.py                  # DB connection
│   ├── services/                        # Business logic
│   │   ├── processing_service.py        # Processing orchestration
│   │   ├── consensus_service.py         # Consensus calculation
│   │   └── queue_service.py             # Queue management
│   └── config.py                        # Configuration
└── gui/                                  # Legacy PyQt GUI
    └── ...
```

### 2.2 Layer Dependencies (Correct)

```
web/routes → web/services → core/*
     ↓            ↓
web/database  web/config
```

Dependencies flow **inward** - web layer depends on core, not vice versa.

### 2.3 Backend Patterns

| Pattern | Implementation | Location |
|---------|----------------|----------|
| Repository | Inline in routes | `routes/*.py` |
| Service Layer | Business logic | `services/*.py` |
| Dependency Injection | FastAPI Depends | `dependencies.py` |
| Factory Pattern | Grid detector creation | `grid_detectors.py` |
| Strategy Pattern | Detection methods | `line_based_detection/strategies/` |
| Protocol (Interface) | ABC classes | `interfaces.py` |

### 2.4 Backend Issues

**Issue 1:** Repository logic mixed into route handlers

**Location:** `routes/screenshots.py:200-280`

```python
# Route handler contains direct DB queries
result = await db.execute(
    select(Screenshot)
    .where(Screenshot.group_id == group_id)
    ...
)
```

**Recommendation:** Extract to a dedicated ScreenshotRepository class.

**Issue 2:** Processing service is too large (673 lines)

**Location:** `services/processing_service.py`

**Recommendation:** Split into smaller focused services:
- `GridProcessingService`
- `BarExtractionService`
- `OCRService`

---

## 3. Frontend Organization

### 3.1 Directory Structure

```
frontend/src/
├── components/                          # React Components
│   ├── annotation/                      # Annotation workflow (12 files)
│   ├── layout/                          # Shell components
│   ├── auth/                            # Authentication
│   ├── admin/                           # Admin views
│   ├── pwa/                             # PWA features
│   └── common/                          # Shared components
├── core/                                # DI Architecture
│   ├── interfaces/                      # Service interfaces
│   │   ├── IScreenshotService.ts
│   │   ├── IAnnotationService.ts
│   │   ├── IConsensusService.ts
│   │   ├── IProcessingService.ts
│   │   └── IStorageService.ts
│   ├── implementations/
│   │   ├── server/                      # API-based implementations
│   │   └── wasm/                        # Client-side implementations
│   ├── di/                              # Dependency injection
│   │   ├── Container.ts                 # Service container
│   │   ├── tokens.ts                    # DI tokens
│   │   └── bootstrap.ts                 # Container setup
│   └── hooks/                           # DI-aware hooks
├── hooks/                               # React hooks
├── store/                               # Zustand stores
├── services/                            # API clients
└── types/                               # TypeScript types
```

### 3.2 DI Architecture (Excellent)

**Location:** `core/di/Container.ts`

```typescript
export class ServiceContainer {
  private services = new Map<string, ServiceImplementation<any>>();
  private singletons = new Map<string, any>();

  register<T>(token: string, implementation: T): void { ... }
  registerFactory<T>(token: string, factory: Factory<T>): void { ... }
  resolve<T>(token: string): T { ... }
  destroy(): void { ... }  // Cleanup with terminate/destroy methods
}
```

**Strengths:**
- Clean token-based resolution
- Factory and singleton support
- Proper cleanup with `destroy()`
- Mode switching (server/WASM) at bootstrap

### 3.3 Service Interfaces (Excellent)

**Location:** `core/interfaces/IScreenshotService.ts`

```typescript
export interface IScreenshotService {
  getNext(groupId?: string, processingStatus?: string): Promise<Screenshot | null>;
  getById(id: number): Promise<Screenshot>;
  getList(params?: ScreenshotListParams): Promise<ScreenshotListResponse>;
  reprocess(id: number, gridCoords: GridCoordinates, ...): Promise<ProcessingResponse>;
  verify(id: number, gridCoords?: GridCoordinates): Promise<Screenshot>;
  ...
}
```

Each interface has two implementations:
- `server/APIScreenshotService.ts` - Uses REST API
- `wasm/WASMScreenshotService.ts` - Uses IndexedDB + local processing

### 3.4 Frontend Issues

**Issue 1:** Duplicate hook patterns

**Location:** `hooks/useAnnotation.ts` and `hooks/useAnnotationWithDI.ts`

Both files exist - `useAnnotation.ts` appears to be legacy.

**Recommendation:** Remove legacy `useAnnotation.ts` after verifying no usage.

**Issue 2:** Large store file

**Location:** `store/createAnnotationStore.ts` (1131 lines)

**Recommendation:** Split into smaller focused stores or use Zustand slices.

---

## 4. Cross-Cutting Concerns

### 4.1 Shared Code

| Concern | Backend | Frontend | Sync Mechanism |
|---------|---------|----------|----------------|
| Types/Schemas | `schemas.py` | `api-schema.ts` | OpenAPI generation |
| Enums | `models.py` | `types/index.ts` | Manual sync |
| Constants | `config.py` | `constants/*.ts` | Manual sync |

### 4.2 Type Generation (Good)

**Command:** `npm run generate:api-types`

Generates TypeScript types from OpenAPI spec, ensuring type consistency.

### 4.3 Configuration Management

**Backend:** `config.py` with Pydantic Settings

```python
class Settings(BaseSettings):
    SECRET_KEY: str
    DATABASE_URL: str = "..."
    CORS_ORIGINS: list[str] = [...]

    model_config = SettingsConfigDict(env_file=".env")
```

**Frontend:** `config/environment.ts`

```typescript
export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
  wsUrl: import.meta.env.VITE_WS_URL || '',
  mode: import.meta.env.VITE_MODE || 'server',
};
```

---

## 5. Code Quality Metrics

### 5.1 File Size Analysis

| File | Lines | Status | Recommendation |
|------|-------|--------|----------------|
| `screenshots.py` | 900+ | Too large | Split by concern |
| `createAnnotationStore.ts` | 1131 | Too large | Use slices |
| `processing_service.py` | 673 | Large | Split by processing type |
| `AnnotationWorkspace.tsx` | 500+ | Large | Extract sub-components |

### 5.2 Naming Conventions

| Area | Convention | Compliance |
|------|------------|------------|
| Python modules | snake_case | 100% |
| Python classes | PascalCase | 100% |
| TypeScript files | PascalCase (components), camelCase (utils) | 95% |
| React components | PascalCase | 100% |
| Interfaces | I-prefix (IService) | 100% |

### 5.3 DRY Principle Compliance

**Duplication Found:**

1. **Enum definitions** (mentioned in 011 review)
2. **Grid coordinate handling** - Same logic in multiple routes
3. **Error handling patterns** - Repeated try/catch blocks

**Recommendation:** Extract common patterns to shared utilities.

---

## 6. Documentation Assessment

### 6.1 Code Documentation

| Type | Coverage | Quality |
|------|----------|---------|
| Docstrings (Python) | 60% | Good where present |
| JSDoc (TypeScript) | 30% | Sparse |
| Interface comments | 80% | Good |
| README | Present | Adequate |
| CLAUDE.md | Present | Excellent for AI |

### 6.2 Missing Documentation

- API endpoint documentation (beyond auto-generated OpenAPI)
- Architecture decision records (ADRs)
- Data flow diagrams
- Deployment runbook

---

## 7. Testing Strategy

### 7.1 Test Organization

```
tests/
├── conftest.py                          # Shared fixtures
├── unit/                                # Unit tests (7 files)
│   ├── test_models.py
│   ├── test_schemas.py
│   ├── test_services.py
│   ├── test_architecture.py
│   └── ...
├── integration/                         # API tests (8 files)
│   ├── conftest.py
│   ├── test_annotation_workflow.py
│   ├── test_upload_workflow.py
│   └── ...
└── e2e/                                 # End-to-end tests (3 files)
    ├── test_complete_workflow.py
    └── ...
```

### 7.2 Test Coverage Patterns

| Test Type | Focus | Strengths |
|-----------|-------|-----------|
| Unit | Models, schemas, pure functions | Good isolation |
| Integration | API workflows | Realistic scenarios |
| E2E | Full user flows | Complete validation |

### 7.3 Test Fixtures (Good)

**Location:** `tests/conftest.py`

```python
@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    # Creates fresh database for each test

@pytest_asyncio.fixture
async def client(db_session) -> AsyncGenerator[AsyncClient, None]:
    # Overrides DB dependency for testing
```

Well-designed fixtures enable easy test writing.

---

## 8. Technical Debt Inventory

### 8.1 Known Issues

| Issue | Location | Priority | Effort |
|-------|----------|----------|--------|
| Legacy PyQt GUI | `gui/` | Low | 4h (remove) |
| Duplicate annotation hooks | `hooks/useAnnotation.ts` | Medium | 1h |
| Large route handlers | `routes/screenshots.py` | Medium | 4h |
| Enum duplication | Multiple | Low | 2h |
| Missing repository layer | Routes | Medium | 8h |

### 8.2 Code Smell Summary

| Smell | Count | Severity |
|-------|-------|----------|
| Long Method | 5 | Medium |
| Large Class | 3 | Medium |
| Feature Envy | 2 | Low |
| Primitive Obsession | 2 | Low |
| Duplicate Code | 3 | Low |

---

## 9. Refactoring Recommendations

### Priority 1: High Impact, Low Effort

| # | Refactoring | Effort | Benefit |
|---|-------------|--------|---------|
| 1.1 | Remove legacy `gui/` package | 1h | Reduce confusion |
| 1.2 | Remove duplicate `useAnnotation.ts` | 30min | Reduce confusion |
| 1.3 | Extract grid coordinate helper functions | 1h | DRY |

### Priority 2: Medium Impact, Medium Effort

| # | Refactoring | Effort | Benefit |
|---|-------------|--------|---------|
| 2.1 | Extract ScreenshotRepository class | 4h | Separation of concerns |
| 2.2 | Split createAnnotationStore into slices | 4h | Maintainability |
| 2.3 | Split processing_service.py | 4h | Single responsibility |

### Priority 3: Architectural Improvements

| # | Refactoring | Effort | Benefit |
|---|-------------|--------|---------|
| 3.1 | Add API versioning middleware | 4h | Future compatibility |
| 3.2 | Implement CQRS for complex queries | 8h | Scalability |
| 3.3 | Add event-driven processing | 16h | Decoupling |

---

## 10. Onboarding Friction Points

### 10.1 Identified Pain Points

| Issue | Impact | Mitigation |
|-------|--------|------------|
| DI architecture complexity | High | Document in README |
| Dual-mode (server/WASM) | High | Add architecture diagram |
| Multiple entry points | Medium | Document in CLAUDE.md |
| Test fixture chain | Medium | Add test writing guide |

### 10.2 Recommended Onboarding Docs

1. **Architecture Overview** - High-level diagram with data flow
2. **Development Setup** - Step-by-step environment setup
3. **Code Contribution Guide** - Coding standards + review checklist
4. **Testing Guide** - How to write and run tests

---

## 11. Conclusion

**Overall Assessment: GOOD**

The codebase is well-organized with clear separation between core logic and web infrastructure. The DI architecture in both backend and frontend enables mode switching and testability.

**Key Strengths:**
- Clean interface segregation (IGridDetector, IBarProcessor, etc.)
- Proper DI container in frontend with mode switching
- Well-structured test fixtures
- Clear package boundaries

**Key Weaknesses:**
- Some large files that should be split
- Legacy code that should be removed
- Missing repository layer in backend
- Documentation gaps

**Priority Actions:**
1. Remove legacy code (`gui/`, duplicate hooks)
2. Split large files into focused modules
3. Add architecture documentation
4. Implement repository pattern for data access

The codebase is maintainable and well-suited for the research tool domain. Recommended improvements are quality-of-life enhancements rather than critical issues.
