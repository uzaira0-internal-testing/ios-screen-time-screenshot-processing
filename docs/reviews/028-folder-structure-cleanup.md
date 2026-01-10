# Folder Structure Cleanup Analysis for Production Readiness

**Date**: 2026-01-01
**Purpose**: Comprehensive analysis of folder structure to identify files/folders that should be cleaned up before production deployment.

---

## Current State Analysis

### Overview

The screenshot-annotator project has accumulated various development artifacts over time:
- **Root directory**: Contains 25 files including several temporary/debug files
- **Development folders**: Multiple folders containing debug outputs, test data, and review documents
- **Data folders**: Large folders (uploads 1.3GB, data 191MB, reference_images 225MB) with mixed content
- **Configuration**: Some redundancy in config files (setup.py, requirements.txt, pyproject.toml)

### Directory Statistics

| Folder | Size | Contents | Purpose |
|--------|------|----------|---------|
| `uploads/` | 1.3 GB | User-uploaded screenshots | Production runtime data |
| `reference_images/` | 225 MB | Test screenshots by resolution | Development/testing |
| `data/` | 191 MB | Participant cropped images | Development test data |
| `reviews/` | 248 KB | Code review documents | Development documentation |
| `prompts/` | 288 KB | Claude prompt history | Development artifacts |
| `issue_screenshots/` | 1.5 MB | Bug reproduction images | Development debugging |
| `debug/` | 588 KB | Debug output images | Development debugging |
| `audits/` | 28 KB | Production readiness audits | Development documentation |

---

## Files to Delete

### Root Directory - Definite Deletions

```
./nul                           - Windows artifact (0 bytes), should be deleted
./temp_bad.png                  - Temporary debug image from Dec 9
./temp_good.png                 - Temporary debug image from Dec 9
./ocr_all_comparison.csv        - OCR benchmark output (development testing)
./ocr_comparison_test.csv       - OCR benchmark output (development testing)
./test_db.db                    - SQLite test database (should use PostgreSQL)
./CLAUDE.md.backup              - Backup of CLAUDE.md (577 lines, older version)
./CLAUDE_NEW.md                 - Draft version of CLAUDE.md (134 lines, incomplete)
./TYPE_CHECKING_AND_TEST_REPORT.md - Dated Dec 2025, now obsolete
./VERIFICATION_SUMMARY.md       - Dated Dec 2025, implementation complete
./whats-next.md                 - Handoff document, work completed
./.coverage                     - pytest coverage file, should be gitignored
```

### Frontend Directory - Definite Deletions

```
./frontend/nul                          - Windows artifact (0 bytes)
./frontend/consensus-*.png              - Debug screenshots (4 files, ~182 KB)
./frontend/debug-*.png                  - Debug screenshots (5 files, ~319 KB)
./frontend/E2E_TEST_PLAN.md             - Moved to tests/TEST_SUMMARY.md or obsolete
./frontend/ENVIRONMENT_VARIABLES.md    - Duplicates info in README.md
./frontend/lighthouse-*.html            - Lighthouse reports (2 files, ~1.1 MB)
./frontend/lighthouse-*.json            - Lighthouse reports (2 files, ~996 KB)
./frontend/dev-dist/                    - PWA dev build artifacts (can regenerate)
./frontend/verify-opencv-fix.sh         - One-time verification script
./frontend/vite.config.canvas.ts        - Unused alternative config
./frontend/nginx.wasm.conf              - Duplicate of docker/nginx/nginx.wasm.conf
./frontend/netlify.toml                 - Deployment config (if not using Netlify)
./frontend/vercel.json                  - Deployment config (if not using Vercel)
```

---

## Folders to Delete or Gitignore

### Recommend: Delete Contents, Keep Folder with .gitkeep

| Folder | Action | Reason |
|--------|--------|--------|
| `debug/` | Clear contents, add to .gitignore | Runtime debug output, 588 KB |
| `issue_screenshots/` | Delete folder | One-time bug reproduction, 1.5 MB |
| `test-resultsscreenshots/` | Delete folder | Misspelled empty folder |
| `.benchmarks/` | Delete folder | Empty benchmark results folder |

### Recommend: Add to .gitignore (Keep Locally)

| Folder | Reason |
|--------|--------|
| `reference_images/` | 225 MB of test images, too large for repo |
| `data/` (contents) | 191 MB participant data, already gitignored |
| `uploads/` (contents) | 1.3 GB runtime data, already gitignored |
| `db/` (contents) | Runtime database, already gitignored |
| `output/` (contents) | Processing output, already gitignored |

### Recommend: Keep but Review for Production

| Folder | Contents | Production Action |
|--------|----------|-------------------|
| `prompts/` | Claude prompts and completed tasks | Move to docs/archive or delete |
| `prompts/completed/` | 19 completed prompt files | Move to docs/archive or delete |
| `reviews/` | 18+ review documents | Keep subset, archive rest |
| `reviews/completed/` | 18 detailed reviews | Keep as reference |
| `audits/` | 2 audit documents | Merge into docs/ |
| `docs/archive/` | Old implementation docs | Already archived |

---

## Files to Move/Reorganize

### Move to `docs/`

```
./README.md                        -> Keep in root (standard)
./audits/production-readiness-audit.md -> ./docs/audits/
./audits/workflow-review.md            -> ./docs/audits/

./frontend/E2E_TEST_PLAN.md        -> ./frontend/tests/E2E_TEST_PLAN.md (if kept)
./frontend/README.md               -> Keep (frontend-specific)
```

### Consolidate Documentation

```
Current:
  ./docs/API_VERSIONING_IMPLEMENTATION.md
  ./docs/DATABASE_BEHAVIOR.md
  ./docs/GRID_DETECTION.md
  ./docs/TRAINING_PLOT_DETECTION_MODEL.md
  ./docs/VERIFICATION_REPORT.md
  ./docs/architecture/ARCHITECTURE.md
  ./docs/architecture/BACKEND_API.md
  ./docs/deployment/BACKUP_STRATEGY.md
  ./docs/deployment/DEPLOYMENT.md
  ./docs/deployment/DOCKER_TESTING_GUIDE.md
  ./docs/getting-started/QUICK_START.md
  ./docs/guides/EPHEMERAL_PROCESSING.md
  ./docs/systems/tagging/

Recommendation:
  - Keep current structure (well-organized)
  - Move root-level technical .md files into docs/ subdirectories
```

---

## Gitignore Updates

### Additions to `.gitignore`

```gitignore
# ===================
# ADD TO .gitignore
# ===================

# Temporary debug files
temp_*.png
temp_*.jpg

# OCR comparison outputs
ocr_*.csv

# Test databases
test_*.db
*.db.backup

# Coverage reports (already partially covered)
.coverage
htmlcov/

# Benchmark results
.benchmarks/

# Issue debugging
issue_screenshots/

# Reference images (too large for repo)
reference_images/

# Lighthouse reports
lighthouse-*.html
lighthouse-*.json

# Debug screenshots
debug-*.png
consensus-*.png

# Windows artifacts
nul

# IDE and editor folders
.idea/
.vscode/
*.swp
*.swo

# Handoff documents
whats-next.md
```

### Additions to `frontend/.gitignore`

```gitignore
# Add to frontend/.gitignore
nul
debug-*.png
consensus-*.png
lighthouse-*.html
lighthouse-*.json
dev-dist/
```

---

## Configuration Cleanup

### Current Redundancy

| File | Purpose | Status |
|------|---------|--------|
| `pyproject.toml` | Modern Python config, package metadata | **Keep** (primary) |
| `setup.py` | Legacy setup, only calls setup() | **Delete** (redundant) |
| `requirements.txt` | Minimal deps for GUI only | **Review** (may be needed for legacy) |
| `pyrightconfig.json` | Type checking config | **Keep** |
| `.env.example` | Environment template | **Keep** |
| `alembic.ini` | Database migration config | **Keep** |

### Recommendation

1. **Delete `setup.py`** - Only contains `from setuptools import setup; setup()` which is handled by pyproject.toml
2. **Review `requirements.txt`** - Contains GUI-only deps (PyQt6, matplotlib, etc.) that are also in pyproject.toml optional deps

### Docker Configuration

All Docker files are well-organized in `docker/` folder:
- `docker-compose.yml` - Production
- `docker-compose.dev.yml` - Development
- `docker-compose.wasm.yml` - WASM-only mode
- Properly structured with `backend/`, `frontend/`, `nginx/`, `paddleocr-server/`, `postgres/`

---

## Documentation Cleanup

### Root-Level Markdown Files

| File | Action | Reason |
|------|--------|--------|
| `README.md` | Keep | Standard project readme |
| `CLAUDE.md` | Keep | AI coding assistant context |
| `CLAUDE.md.backup` | Delete | Older version backup |
| `CLAUDE_NEW.md` | Delete | Incomplete draft |
| `TYPE_CHECKING_AND_TEST_REPORT.md` | Delete | Completed task report |
| `VERIFICATION_SUMMARY.md` | Delete | Completed task report |
| `whats-next.md` | Delete | Handoff doc for completed work |

### Reviews Folder Organization

Current: 18+ review files in `reviews/` plus `reviews/completed/` with 18 more

Recommendation:
1. Keep `reviews/` for active review documents
2. Archive older reviews (006-010) into `docs/archive/reviews/`
3. Keep recent reviews (011-028) as active reference

### Prompts Folder

Current: `prompts/` contains prompt templates, `prompts/completed/` has 19 completed prompts

Recommendation for Production:
- **Option A**: Delete entire `prompts/` folder (development artifact)
- **Option B**: Move to `docs/archive/prompts/` for historical reference
- Recommended: **Option A** for production, **Option B** if audit trail needed

---

## Recommended Final Structure

```
screenshot-annotator/
├── .env.example              # Environment template
├── .gitignore                # Updated with new patterns
├── alembic.ini               # Database migrations config
├── CLAUDE.md                 # AI assistant context
├── pyproject.toml            # Python package config (primary)
├── pyrightconfig.json        # Type checking config
├── README.md                 # Project overview
├── uv.lock                   # Dependency lock file
│
├── alembic/                  # Database migrations
│   ├── versions/             # Migration scripts
│   └── env.py
│
├── data/                     # [gitignored] Test data
│   └── .gitkeep
│
├── db/                       # [gitignored] Runtime database
│   └── .gitkeep
│
├── debug/                    # [gitignored] Debug output
│   └── .gitkeep
│
├── docker/                   # Docker configuration
│   ├── backend/
│   ├── frontend/
│   ├── nginx/
│   ├── paddleocr-server/
│   ├── postgres/
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   └── docker-compose.wasm.yml
│
├── docs/                     # Documentation
│   ├── architecture/         # System design docs
│   ├── archive/              # Historical docs
│   ├── deployment/           # Deployment guides
│   ├── getting-started/      # Quick start
│   ├── guides/               # How-to guides
│   └── systems/              # System docs (tagging)
│
├── frontend/                 # React/TypeScript frontend
│   ├── public/
│   ├── src/
│   ├── tests/
│   ├── dist/                 # [gitignored] Build output
│   └── node_modules/         # [gitignored]
│
├── output/                   # [gitignored] Processing output
│   └── .gitkeep
│
├── scripts/                  # Utility scripts
│
├── src/screenshot_processor/ # Python package
│   ├── cli/
│   ├── core/
│   ├── gui/
│   └── web/
│
├── tests/                    # Python tests
│   ├── e2e/
│   ├── fixtures/
│   ├── integration/
│   └── unit/
│
└── uploads/                  # [gitignored] User uploads
    └── .gitkeep
```

### Folders Removed from Production

- `issue_screenshots/` - Deleted (one-time debugging)
- `reference_images/` - Gitignored or moved to external storage
- `prompts/` - Deleted or archived
- `reviews/` - Archived older reviews, keep recent ones
- `audits/` - Merged into docs/
- `test-resultsscreenshots/` - Deleted (typo folder)
- `.benchmarks/` - Deleted (empty)

---

## Implementation Steps

### Phase 1: Immediate Cleanup (Safe to Delete)

```bash
# Navigate to project root
cd D:/Scripts/monorepo/apps/screenshot-annotator

# Delete Windows artifacts
rm -f nul
rm -f frontend/nul

# Delete temporary debug files
rm -f temp_bad.png temp_good.png

# Delete OCR benchmark outputs
rm -f ocr_all_comparison.csv ocr_comparison_test.csv

# Delete test database
rm -f test_db.db

# Delete backup/draft CLAUDE files
rm -f CLAUDE.md.backup CLAUDE_NEW.md

# Delete completed task reports
rm -f TYPE_CHECKING_AND_TEST_REPORT.md VERIFICATION_SUMMARY.md whats-next.md

# Delete coverage file
rm -f .coverage

# Delete empty/misspelled folders
rm -rf test-resultsscreenshots/
rm -rf .benchmarks/
```

### Phase 2: Frontend Cleanup

```bash
cd frontend

# Delete Windows artifact
rm -f nul

# Delete debug screenshots
rm -f debug-*.png consensus-*.png

# Delete Lighthouse reports (can regenerate)
rm -f lighthouse-*.html lighthouse-*.json

# Delete dev-dist (can regenerate)
rm -rf dev-dist/

# Optional: Delete unused deploy configs
# rm -f netlify.toml vercel.json  # Only if not using these platforms
```

### Phase 3: Update .gitignore

Add the patterns listed in "Gitignore Updates" section to both:
- `./gitignore`
- `./frontend/.gitignore`

### Phase 4: Folder Cleanup

```bash
cd D:/Scripts/monorepo/apps/screenshot-annotator

# Delete issue screenshots folder
rm -rf issue_screenshots/

# Clear debug folder contents
rm -rf debug/*
touch debug/.gitkeep

# Archive or delete prompts folder
# Option A (delete):
rm -rf prompts/

# Option B (archive):
# mkdir -p docs/archive/prompts
# mv prompts/* docs/archive/prompts/
# rm -rf prompts/

# Merge audits into docs
mkdir -p docs/audits
mv audits/* docs/audits/
rm -rf audits/
```

### Phase 5: Configuration Cleanup

```bash
# Delete redundant setup.py
rm -f setup.py

# Review if requirements.txt is still needed
# Keep if legacy GUI mode needs it, otherwise delete
# rm -f requirements.txt
```

### Phase 6: Documentation Organization

```bash
# Move root technical docs to docs/ if desired
# (Optional - current structure is acceptable)
```

### Phase 7: Handle Large Data Folders

```bash
# For reference_images/ (225 MB):
# Option A: Delete if test data is reproducible
# rm -rf reference_images/

# Option B: Add to .gitignore and keep locally
# Already added in .gitignore updates

# For data/, output/, uploads/, db/:
# Already gitignored - no action needed
# Just ensure .gitkeep files exist
touch data/.gitkeep
touch output/.gitkeep
touch uploads/.gitkeep
touch db/.gitkeep
```

---

## Verification Checklist

After cleanup, verify:

- [ ] Backend starts without errors: `uvicorn src.screenshot_processor.web.api.main:app --reload`
- [ ] Frontend builds: `cd frontend && npm run build`
- [ ] Tests pass: `pytest tests/ -v`
- [ ] Docker builds: `docker compose -f docker/docker-compose.dev.yml build`
- [ ] No sensitive data in repo: `git status` shows no .env files
- [ ] Documentation is accessible: `docs/README.md` links work
- [ ] .gitignore covers all runtime artifacts

---

## Summary

### By the Numbers

| Category | Current | After Cleanup | Savings |
|----------|---------|---------------|---------|
| Root files | 25 | 13 | 12 files |
| Root folders | 23 | 17 | 6 folders |
| Frontend debug files | 11 | 0 | ~2 MB |
| Total estimated cleanup | - | - | ~230+ MB (if reference_images deleted) |

### Key Actions

1. **Delete 12 root files** - temp files, backups, obsolete reports
2. **Delete 11 frontend files** - debug screenshots, lighthouse reports
3. **Delete 3 folders** - issue_screenshots, test-resultsscreenshots, .benchmarks
4. **Update .gitignore** - Add 20+ new patterns
5. **Consolidate config** - Remove redundant setup.py
6. **Archive prompts/audits** - Move to docs/archive or delete

### Production Readiness Impact

- **Storage**: Potential reduction of 230+ MB from repo
- **Security**: Removes temp files that could contain debug info
- **Maintainability**: Cleaner structure, clear separation of concerns
- **CI/CD**: Smaller checkout size, faster builds

---

*Report generated by Claude Code analysis on 2026-01-01*
