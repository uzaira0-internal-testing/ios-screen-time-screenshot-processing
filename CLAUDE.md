# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

iOS Screen Time Screenshot Processing - a dual-mode platform for extracting battery and screen time usage data from iOS screenshots using OCR. Supports both a **client-server architecture** with multi-user collaboration and a **100% client-side WASM mode** for offline/local processing.

## Development Commands

### Backend (Python)

```bash
# Install dependencies (from project root)
pip install -e ".[web,dev]"            # Or: uv sync

# Start PostgreSQL (required for server mode)
docker compose -f docker/docker-compose.dev.yml up -d

# Start backend API (if not using Docker)
uvicorn src.screenshot_processor.web.api.main:app --reload --host 127.0.0.1 --port 8002

# Database migrations
alembic upgrade head                   # Apply migrations
alembic revision --autogenerate -m "description"  # Create migration

# Run Python tests
pytest tests/unit/ -v                  # Unit tests
pytest tests/integration/ -v           # Integration tests
pytest tests/e2e/ -v                   # End-to-end tests
pytest tests/integration/test_annotation_workflow.py::test_name -v  # Single test

# Lint and format
ruff check . && ruff format .
```

### Frontend

```bash
cd frontend

bun install                           # Install dependencies
bun run dev                           # Start dev server (http://localhost:5175)
bun run build                         # Production build (runs tsc first)
bun run type-check                    # TypeScript checking only

# Generate TypeScript types from OpenAPI spec
bun run generate:api-types

# Playwright E2E tests (requires backend + PostgreSQL running)
bun run test:e2e                      # Run all tests
bun run test:e2e:ui                   # Interactive UI mode
bun run test:e2e:headed               # Visible browser
bun run test:e2e:debug                # Debug mode
```

### Docker

```bash
# Development with hot reloading and production data
docker compose --env-file docker/.env -f docker/docker-compose.dev.yml up -d

# Production stack
docker compose -f docker/docker-compose.yml up -d

# WASM-only mode (100% client-side, no backend)
docker compose -f docker/docker-compose.wasm.yml up -d

# From docker/ directory
cd docker && docker compose -f docker-compose.dev.yml up -d
```

### Database Backups

Automated daily backups run at 2:00 AM via systemd timer. Backups are stored on the **host filesystem** (`/home/uzair/backups/ios-screen-time/`), completely outside Docker volumes.

```bash
# Manual backup (DB + uploaded files)
./scripts/backup-db.sh

# Database-only backup
./scripts/backup-db.sh --db-only

# List available backups
./scripts/restore-db.sh --list

# Restore latest backup (interactive — asks for confirmation)
./scripts/restore-db.sh

# Restore specific backup
./scripts/restore-db.sh /home/uzair/backups/ios-screen-time/db/<file>.dump

# Check timer status
systemctl --user status screenshot-backup.timer

# View backup logs
cat /home/uzair/backups/ios-screen-time/logs/backup.log
```

### Docker Directory Structure

```
docker/
├── backend/
│   └── Dockerfile              # Python API container (Tesseract OCR, uvicorn)
├── frontend/
│   ├── Dockerfile              # Production multi-stage (Node build → Nginx serve)
│   ├── Dockerfile.dev          # Development with Bun dev server + HMR
│   └── Dockerfile.wasm         # WASM-only static build
├── nginx/
│   ├── nginx.conf              # Production nginx with API proxy, security headers
│   └── nginx.wasm.conf         # WASM-only nginx (no backend proxy)
├── docker-compose.yml          # Production stack (PostgreSQL, Redis, API, Celery, Nginx)
├── docker-compose.dev.yml      # Development stack with hot reloading
└── docker-compose.wasm.yml     # WASM-only stack (frontend only)
```

**Development hot reloading:**
- Frontend: Custom Bun dev server with HMR via volume mounts (`./frontend/src:/app/src`). Uses `window.__CONFIG__` for runtime BASE_PATH injection.
- Backend: Uvicorn `--reload` with mounted source code
- Celery: Worker restarts on code changes

**Note:** `bun` is NOT available on the host — only inside the Docker frontend container. For host-side type-checking, use `cd frontend && npx tsc --noEmit`.

## Architecture

### Dual-Mode System

The application runs in two mutually exclusive modes:

| Mode | Backend | Storage | OCR | Use Case |
|------|---------|---------|-----|----------|
| **Server** | FastAPI + PostgreSQL | Server filesystem | HybridOCR (Hunyuan/PaddleOCR/Tesseract) | Multi-user collaboration |
| **WASM** | None | IndexedDB + Blob storage | Tesseract.js in Web Worker | Offline/local processing |

Mode detection: Presence of `VITE_API_BASE_URL` environment variable.

### Backend Structure

```
src/screenshot_processor/
├── core/                             # Processing logic (shared with GUI)
│   ├── image_processor.py            # Grid detection, bar extraction, ROI calculation
│   ├── ocr.py                        # Title/total extraction using OCR
│   ├── grid_detectors.py             # Grid boundary detection strategies
│   ├── bar_processor.py              # Bar height extraction from graph
│   ├── line_based_detection/         # Strategy pattern for line detection
│   │   ├── detector.py               # Main detector orchestrating strategies
│   │   └── strategies/               # Vertical/horizontal line strategies
│   └── ocr_engines/                  # OCR engine abstraction
│       ├── hybrid_engine.py          # Auto-fallback: Hunyuan -> PaddleOCR -> Tesseract
│       ├── hunyuan_engine.py         # Vision LLM via vLLM (best quality)
│       ├── paddleocr_remote_engine.py # PaddleOCR HTTP API (good quality + bboxes)
│       ├── tesseract_engine.py       # Local Tesseract (always available)
│       └── paddleocr_engine.py       # Local PaddleOCR (requires paddleocr extra)
├── web/
│   ├── api/
│   │   ├── main.py                   # FastAPI app, CORS, rate limiting (slowapi)
│   │   ├── v1/                       # Versioned API router
│   │   ├── routes/                   # Endpoint modules
│   │   └── dependencies.py           # Auth, DB session injection
│   ├── database/
│   │   ├── models.py                 # SQLAlchemy 2.0 async models
│   │   └── schemas.py                # Pydantic request/response schemas
│   ├── services/                     # Business logic layer
│   └── websocket/manager.py          # Real-time event broadcasting
└── gui/                              # PyQt6 desktop application (standalone)
```

### Frontend DI Architecture

The frontend uses a service container pattern for mode switching:

```
frontend/src/core/
├── interfaces/                       # Service contracts (I*.ts)
│   ├── IScreenshotService.ts         # Screenshot CRUD
│   ├── IAnnotationService.ts         # Annotation submission
│   ├── IConsensusService.ts          # Consensus calculation
│   ├── IProcessingService.ts         # OCR/grid detection
│   └── IStorageService.ts            # Blob storage abstraction
├── implementations/
│   ├── server/                       # API-based (axios calls)
│   └── wasm/                         # Client-side implementations
│       ├── WASMProcessingService.ts  # Tesseract.js + canvas processing
│       ├── storage/
│       │   ├── IndexedDBStorageService.ts  # Dexie-based storage
│       │   └── database/ScreenshotDB.ts    # Schema + migrations
│       └── processing/
│           ├── gridDetection.canvas.ts     # Port of Python grid detection
│           ├── barExtraction.canvas.ts     # Port of Python bar extraction
│           └── workers/                    # Web Worker for OCR
├── di/
│   ├── Container.ts                  # Generic service container
│   ├── bootstrap.ts                  # Mode-specific registration
│   └── tokens.ts                     # Service identifiers
└── hooks/useServices.ts              # React hook for DI access
```

### Image Processing Pipeline

Both Python and WASM implementations follow this flow:

1. **Load & Normalize** → Convert dark mode, adjust contrast/brightness
2. **Grid Detection** → Find "12AM" and "60" anchors via OCR, extract ROI boundaries
3. **Bar Extraction** → Slice ROI into 24 columns, measure bar heights
4. **Title/Total OCR** → Extract app name and total usage time
5. **Alignment Validation** → `compute_bar_alignment_score()` detects grid misalignment

Key function: `slice_image()` in `image_processor.py` - extracts 24 hourly values from the bar graph.

### OCR Engine Configuration

The project uses a **HybridOCREngine** that automatically falls back between multiple OCR backends:

| Engine | Location | Quality | Bounding Boxes | Use Case |
|--------|----------|---------|----------------|----------|
| HunyuanOCR | Remote (vLLM) | Best | **No** | Text extraction on pre-cropped regions or full images |
| PaddleOCR | Remote (Docker) | Good | Yes | Grid anchor detection, text with positions |
| Tesseract | Local | Basic | Yes | Offline fallback (always available) |

**Network endpoints** (LOCAL network, not internet):
- HunyuanOCR: `http://cnrc-rtx4090.ad.bcm.edu:8080`
- PaddleOCR: `http://cnrc-rtx4090.ad.bcm.edu:8081`

**"Offline"** = not connected to local network = Tesseract fallback only.

### OCR Use Cases

There are 5 distinct OCR use cases. Each has different requirements:

| Use Case | File | Method | Priority Chain | Requires |
|----------|------|--------|----------------|----------|
| Grid Anchor Detection | `image_processor.py` | `extract_text_with_bboxes()` | PaddleOCR -> Tesseract | **Bboxes** |
| Title Extraction | `ocr.py` | `extract_text()` | HunyuanOCR -> PaddleOCR -> Tesseract | Text quality |
| Total Usage Extraction | `ocr.py` | `extract_text()` | HunyuanOCR -> PaddleOCR -> Tesseract | Text quality |
| Daily Page Detection | `ocr.py` | `extract_text()` | HunyuanOCR -> PaddleOCR -> Tesseract | Keyword matching |
| PHI Detection (pipeline) | `apps/pipeline/` | `extract_text()` | HunyuanOCR -> PaddleOCR -> Tesseract | Comprehensive |

**Important**: HunyuanOCR cannot return bounding boxes. It should only be used on image regions already cropped using bbox coordinates from PaddleOCR/Tesseract, or for full-image text extraction where positions don't matter.

**NOT an OCR use case**: Bar graph extraction uses pixel color analysis, not OCR. See `slice_image()` and `bar_processor.py`.

**Testing**: Run `scripts/test_hybrid_all_use_cases.py` to verify all OCR use cases work correctly.

### API Routes

```
/api/v1/
├── /auth/login              POST    X-Username header auth (auto-creates users)
├── /auth/me                 GET     Current user profile
├── /screenshots/
│   ├── /next                GET     Get next unprocessed screenshot
│   ├── /{id}                GET     Screenshot by ID
│   ├── /{id}/image          GET     Serve image file
│   ├── /stats               GET     Queue statistics
│   ├── /upload              POST    Upload screenshot (X-API-Key auth, base64 JSON body)
│   ├── /upload/browser      POST    Browser-based upload (multipart form)
│   ├── /groups              GET     List groups
│   ├── /list                GET     Paginated screenshot list
│   ├── /preprocessing-summary GET   Pipeline stage counts
│   ├── /{id}/preprocessing  GET     Preprocessing details for screenshot
│   ├── /{id}/preprocess     POST    Run preprocessing on single screenshot
│   ├── /preprocess-batch    POST    Run preprocessing on batch
│   ├── /preprocess-stage/*  POST    Run individual pipeline stages
│   ├── /{id}/phi-regions    GET/PUT PHI region management
│   ├── /{id}/apply-redaction POST   Apply PHI redaction
│   ├── /{id}/manual-crop    POST    Manual crop adjustment
│   ├── /{id}/original-image GET     Original (unprocessed) image
│   ├── /{id}/stage-image    GET     Image at specific pipeline stage
│   └── /export/csv          GET     Export data as CSV
├── /annotations/
│   ├── /                    POST    Submit annotation
│   └── /history             GET     User's annotation history
├── /consensus/{id}          GET     Consensus analysis for screenshot
└── /admin/                          (requires admin role)
    ├── /users               GET     User management
    ├── /users/{id}          PUT     Update user role/status
    ├── /groups/{id}         DELETE  Delete group and all screenshots
    ├── /reset-test-data     POST    Reset test data for e2e tests
    ├── /recalculate-ocr-totals POST Recalculate OCR totals
    └── /bulk-reprocess      POST    Queue screenshots for reprocessing
```

## Configuration

### Backend (.env)

```bash
# Required
DATABASE_URL=postgresql+asyncpg://screenshot:screenshot@localhost:5435/screenshot_annotations
SECRET_KEY=<64-char-hex>              # python -c "import secrets; print(secrets.token_hex(32))"
UPLOAD_API_KEY=<api-key>              # For programmatic uploads

# Optional
DEBUG=False
CORS_ORIGINS=http://localhost:3000,http://localhost:5175
RATE_LIMIT_DEFAULT=100/minute
CONSENSUS_DISAGREEMENT_THRESHOLD_MINUTES=0  # 0 = flag any difference

# OCR Configuration (optional - defaults shown)
OCR_ENGINE_TYPE=hybrid                # tesseract, hunyuan, paddleocr_remote, or hybrid
HUNYUAN_OCR_URL=http://cnrc-rtx4090.ad.bcm.edu:8080
PADDLEOCR_URL=http://cnrc-rtx4090.ad.bcm.edu:8081
```

### Frontend (frontend/.env)

```bash
# Server mode (set these — used at build time, injected via window.__CONFIG__ at runtime)
VITE_API_BASE_URL=http://localhost:8002/api/v1
VITE_WS_URL=ws://localhost:8002/api/v1/ws

# WASM mode (omit VITE_API_BASE_URL entirely)
```

## Key Patterns

### Authentication

Header-based auth using `X-Username` header. Users auto-created on first request. Username "admin" grants admin role. **Internal research tool only** - no password verification.

### Consensus Detection

- Triggered when 2+ annotations exist for a screenshot
- Thresholds: Minor (≤2min), Moderate (≤5min), Major (>5min)
- Strategies: median (default), mean, mode

### WebSocket Events

Real-time broadcasts: `annotation_submitted`, `screenshot_completed`, `consensus_disputed`, `user_joined`, `user_left`

### State Management

Zustand stores in `frontend/src/store/` with React context for DI container access.

## Testing

### Backend (pytest)

- `tests/unit/` - Unit tests for core processing
- `tests/integration/` - API workflow tests (requires PostgreSQL)
- `tests/e2e/` - Full system tests
- `tests/fixtures/` - Test images and data

### Frontend (Playwright)

- `frontend/tests/e2e/` - User workflow tests
- `frontend/tests/visual/` - Visual regression
- `frontend/tests/accessibility/` - a11y tests
- Uses PostgreSQL (docker-compose.dev.yml) and auto-starts backend/frontend in local dev

## Admin & Screenshot Management Features

### Admin Features (username "admin" only)

- **Delete Group**: Permanently delete a group and all its screenshots via the trash icon on group cards on the homepage
- **User Management**: View user statistics and manage roles via admin dashboard

### Screenshot Management

- **Soft Delete**: Screenshots can be soft-deleted by setting `processing_status` to "deleted"
  - API: `POST /screenshots/{id}/soft-delete`
  - Previous status stored in `processing_metadata.pre_delete_status` for restoration
  - Deleted screenshots visible in separate "Deleted" category on homepage (click to view/restore)

- **Restore**: Restore soft-deleted screenshots to their previous status
  - API: `POST /screenshots/{id}/restore`
  - Returns screenshot to original `processing_status`

- **Browse Mode**: When filtering by `processing_status` (e.g., clicking "skipped" on homepage), all matching screenshots are shown regardless of annotation status (browse mode enabled automatically)

### Processing Status Values

| Status | Description |
|--------|-------------|
| `pending` | Waiting for OCR processing |
| `processing` | Currently being processed |
| `completed` | Successfully processed |
| `failed` | Processing error |
| `skipped` | Daily Total detected (skip annotation) |
| `deleted` | Soft-deleted (can be restored) |

## Technical Debt

| Item | Effort | Description |
|------|--------|-------------|
| Extract more DB queries to repository | 8h | Routes still have ~58 direct DB queries — migrate to `ScreenshotRepository` |

See `docs/reviews/` for detailed architecture analysis and completed items.

## Type System (CRITICAL)

**Pydantic is the SINGLE SOURCE OF TRUTH** for all API contracts. This is non-negotiable.

### The Flow

```
Pydantic schemas (backend) → OpenAPI spec → TypeScript types (frontend)
```

1. Backend schemas: `src/screenshot_processor/web/database/schemas.py`
2. FastAPI auto-generates OpenAPI spec from Pydantic models
3. Frontend types generated via `bun run generate:api-types`
4. Types output to `frontend/src/types/api-schema.ts`

### NEVER DO THIS

```typescript
// WRONG - Defining types manually in frontend
interface UserActivity {
  id: number;
  username: string;
  email: string;  // This will drift from backend!
}

// WRONG - Using raw fetch() instead of typed client
const response = await fetch(`${API_URL}/admin/users`);
const data = await response.json();  // No type safety!

// WRONG - Creating duplicate axios instances
const api = axios.create({ baseURL: API_URL });  // Untyped!
```

### ALWAYS DO THIS

```typescript
// CORRECT - Import types from OpenAPI schema
import type { components } from "@/types/api-schema";
type UserActivity = components["schemas"]["UserStatsRead"];

// CORRECT - Use the typed apiClient (openapi-fetch)
import { api } from "@/services/apiClient";
const users = await api.admin.getUsers();  // Fully typed!

// CORRECT - Re-export types for convenience
export type GroupVerificationSummary = components["schemas"]["GroupVerificationSummary"];
```

### After Backend Schema Changes

```bash
cd frontend && bun run generate:api-types
```

**If you find yourself defining a TypeScript interface that mirrors a backend model, STOP. Use the generated types.**

## Claude Code Automations

This project has Claude Code automations configured in `.claude/`, `.mcp.json`, and `.claude/settings.json`.

### MCP Servers (`.mcp.json`)

| Server | Purpose |
|--------|---------|
| **context7** | Live documentation lookup for React, FastAPI, SQLAlchemy, Zustand, Playwright, and other libraries. Use `resolve-library-id` then `query-docs` to get current API docs. |
| **Playwright** | Browser automation and testing. Use for visual verification of the running app during development. |

### Hooks (`.claude/settings.json`)

| Hook | Event | What it does |
|------|-------|--------------|
| **Auto-format Python** | PostToolUse (Edit/Write) | Runs `ruff format` and `ruff check --fix` on any edited `.py` files |
| **Block .env edits** | PreToolUse (Edit/Write) | Prevents accidental edits to `.env` files containing secrets. Edit `.env.example` instead and tell user to update `.env` manually. |

### Skills (`.claude/skills/`)

| Skill | Invocation | Purpose |
|-------|------------|---------|
| `/generate-api-types` | User-only | Regenerate frontend TypeScript types from backend OpenAPI spec. Run after any Pydantic schema or API route changes. |
| `/backup-restore` | User-only | Database backup and restore operations. Lists, creates, and restores PostgreSQL backups. |

### Subagents (`.claude/agents/`)

| Agent | When to use |
|-------|-------------|
| **security-reviewer** | After modifying upload endpoints, PHI handling, auth middleware, or any code processing user input. Checks for HIPAA compliance, injection risks, and data exposure. |
| **api-contract-verifier** | After modifying Pydantic schemas or API routes. Detects type drift between backend schemas and frontend TypeScript types. Recommends running `/generate-api-types` if stale. |
