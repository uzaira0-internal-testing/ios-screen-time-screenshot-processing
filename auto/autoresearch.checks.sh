#!/usr/bin/env bash
# Correctness checks — runs after every passing benchmark.
# Failures block "keep". Only show errors — suppress verbose success output.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker/docker-compose.dev.yml"
CONTAINER="backend"

# Sync source files to container (they're mounted, but test files aren't)
for f in tests/unit/*.py tests/conftest.py tests/__init__.py; do
    [ -f "$f" ] || continue
    dir_in_container=$(dirname "$f")
    docker compose -f "$COMPOSE_FILE" exec "$CONTAINER" mkdir -p "$dir_in_container" 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" cp "$f" "$CONTAINER:/app/$f" 2>/dev/null
done

echo "--- Unit tests (core processing) ---"
# Only run tests for the files in scope (core image processing)
docker compose -f "$COMPOSE_FILE" exec "$CONTAINER" \
    python -m pytest tests/unit/test_image_utils.py tests/unit/test_bar_extraction.py tests/unit/test_image_processor.py tests/unit/test_ocr_extraction.py -x -q --tb=short 2>&1 | tail -10

echo ""
echo "--- Python lint (ruff) ---"
ruff check src/screenshot_processor/core/ --quiet 2>&1 | tail -5 || true

echo ""
echo "--- Import check ---"
docker compose -f "$COMPOSE_FILE" exec "$CONTAINER" \
    python -c "from screenshot_processor.core.image_utils import convert_dark_mode, darken_non_white, reduce_color_count, scale_up; print('Core imports OK')"
