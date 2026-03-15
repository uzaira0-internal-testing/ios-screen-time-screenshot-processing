#!/usr/bin/env bash
set -euo pipefail

# Local test runner — runs EVERYTHING. CI is only for Tauri release builds.
# Usage:
#   ./scripts/test-all.sh          # Run all tests
#   ./scripts/test-all.sh quick    # Lint + typecheck + unit tests only (~30s)
#   ./scripts/test-all.sh full     # All tests including integration + security

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0
SKIPPED=0

run() {
  local name="$1"
  shift
  printf "${YELLOW}▸ %-40s${NC}" "$name"
  if "$@" > /tmp/test-output.log 2>&1; then
    printf "${GREEN}PASS${NC}\n"
    ((PASSED++))
  else
    printf "${RED}FAIL${NC}\n"
    cat /tmp/test-output.log | tail -5 | sed 's/^/  /'
    ((FAILED++))
  fi
}

skip() {
  local name="$1"
  local reason="$2"
  printf "${YELLOW}▸ %-40s${NC}SKIP (%s)\n" "$name" "$reason"
  ((SKIPPED++))
}

MODE="${1:-full}"
DOCKER_BACKEND="docker compose --env-file docker/.env -f docker/docker-compose.dev.yml exec -T backend"
CONTAINER=$(docker compose --env-file docker/.env -f docker/docker-compose.dev.yml ps -q backend 2>/dev/null || true)

echo "================================================"
echo "  Test Suite — mode: $MODE"
echo "================================================"
echo ""

# ── Lint & Typecheck (always) ──────────────────────────────────────────
echo "── Lint & Typecheck ──"
run "Backend lint (ruff)"          ruff check src/
run "Backend format check"         ruff format --check src/
run "Frontend typecheck"           bash -c "cd frontend && bun run typecheck"
run "Frontend lint"                bash -c "cd frontend && bun run lint 2>&1 | grep -q '0 errors'"
echo ""

# ── Unit Tests ─────────────────────────────────────────────────────────
echo "── Unit Tests ──"
if [ -n "$CONTAINER" ]; then
  run "Python unit tests" $DOCKER_BACKEND python -m pytest tests/unit/ -v --tb=short -q
else
  skip "Python unit tests" "Docker backend not running"
fi
echo ""

if [ "$MODE" = "quick" ]; then
  echo ""
  echo "================================================"
  printf "  Results: ${GREEN}%d passed${NC}, ${RED}%d failed${NC}, %d skipped\n" "$PASSED" "$FAILED" "$SKIPPED"
  echo "================================================"
  exit $FAILED
fi

# ── Integration Tests ──────────────────────────────────────────────────
echo "── Integration Tests ──"
if [ -n "$CONTAINER" ]; then
  run "Python integration tests" $DOCKER_BACKEND python -m pytest tests/integration/ -v --tb=short -q
else
  skip "Python integration tests" "Docker backend not running"
fi
echo ""

# ── Security ───────────────────────────────────────────────────────────
echo "── Security ──"
if command -v gitleaks &>/dev/null || [ -f ~/.local/bin/gitleaks ]; then
  GITLEAKS="${GITLEAKS:-$(command -v gitleaks 2>/dev/null || echo ~/.local/bin/gitleaks)}"
  run "Secret scan (gitleaks)" "$GITLEAKS" detect --source . --no-git -c .gitleaks.toml
else
  skip "Secret scan" "gitleaks not installed"
fi

if [ -n "$CONTAINER" ]; then
  run "pip-audit" $DOCKER_BACKEND pip-audit --strict 2>/dev/null || skip "pip-audit" "pip-audit not installed in container"
else
  skip "pip-audit" "Docker backend not running"
fi
echo ""

# ── Contract Drift ────────────────────────────────────────────────────
echo "── Contract Drift ──"
if [ -f frontend/scripts/check-contract-drift.sh ]; then
  run "API contract drift" bash -c "cd frontend && bash scripts/check-contract-drift.sh"
else
  skip "API contract drift" "Script not found"
fi
echo ""

# ── Smoke Test ─────────────────────────────────────────────────────────
echo "── Smoke Test ──"
if curl -sf http://localhost:8002/health > /dev/null 2>&1; then
  # Load site password if available
  SITE_PASSWORD=""
  if [ -f docker/.env ]; then
    SITE_PASSWORD=$(grep "^SITE_PASSWORD=" docker/.env 2>/dev/null | cut -d= -f2 || true)
  fi
  run "Deployment smoke test" bash -c "SITE_PASSWORD='$SITE_PASSWORD' bash scripts/smoke-test.sh"
else
  skip "Deployment smoke test" "Backend not reachable"
fi
echo ""

# ── Bundle Size ────────────────────────────────────────────────────────
echo "── Build Checks ──"
run "Frontend build" bash -c "cd frontend && bun run build 2>&1 | tail -1"
echo ""

# ── Summary ────────────────────────────────────────────────────────────
echo "================================================"
printf "  Results: ${GREEN}%d passed${NC}, ${RED}%d failed${NC}, %d skipped\n" "$PASSED" "$FAILED" "$SKIPPED"
echo "================================================"

[ "$FAILED" -eq 0 ] || exit 1
