#!/usr/bin/env bash
# Autoresearch benchmark runner for iOS Screen Time image processing pipeline
# Runs: pre-checks (fast gate) → benchmark (N runs, take best)
# Outputs METRIC lines for the agent to parse
# Exit code 0 = all good, non-zero = broken
set -euo pipefail

cd "$(dirname "$0")/.."

# ── Configuration ─────────────────────────────────────────────────
COMPOSE_FILE="docker/docker-compose.dev.yml"
PRECHECK_CMD="./auto/autoresearch.checks.sh"
RUNS=3
CONTAINER="backend"

# Files to copy into Docker container for benchmarks
BENCH_FILES=(
    "tests/benchmark/test_benchmarks.py"
    "tests/conftest.py"
    "tests/__init__.py"
)

# ── Helpers ──────────────────────────────────────────────────────
sync_to_container() {
    echo "=== Syncing files to container ==="
    for f in "${BENCH_FILES[@]}"; do
        dir_in_container=$(dirname "$f")
        docker compose -f "$COMPOSE_FILE" exec "$CONTAINER" mkdir -p "$dir_in_container" 2>/dev/null || true
        docker compose -f "$COMPOSE_FILE" cp "$f" "$CONTAINER:/app/$f" 2>/dev/null
    done
    echo "Synced."
}

run_benchmark() {
    local test_filter="$1"
    local metric_name="$2"

    local BEST=999999999
    local BEST_RAW=""

    for i in $(seq 1 $RUNS); do
        # Run benchmark and save JSON result
        docker compose -f "$COMPOSE_FILE" exec "$CONTAINER" \
            python -m pytest tests/benchmark/test_benchmarks.py \
            -k "$test_filter" \
            --benchmark-only \
            --benchmark-json=/tmp/bench_result.json \
            -q > /dev/null 2>&1 || true

        # Extract mean time from JSON (seconds → microseconds), strip whitespace
        VAL=$(docker compose -f "$COMPOSE_FILE" exec "$CONTAINER" \
            python -c "
import json
with open('/tmp/bench_result.json') as f:
    data = json.load(f)
for b in data.get('benchmarks', []):
    print(int(b['stats']['mean'] * 1_000_000))
" 2>/dev/null | tr -d '[:space:]')

        if [ -z "$VAL" ]; then
            echo "  run $i: could not extract ${metric_name}"
            continue
        fi

        echo "  run $i: ${metric_name}=${VAL}"

        if [ "$VAL" -lt "$BEST" ]; then
            BEST=$VAL
            BEST_RAW=$VAL
        fi
    done

    if [ "$BEST" = "999999999" ]; then
        echo "FATAL: no valid benchmark results for ${metric_name}"
        return 1
    fi

    echo "METRIC ${metric_name}=${BEST_RAW}"
}

# ── Step 1: Pre-checks (fast correctness gate) ──────────────────
if [ -n "$PRECHECK_CMD" ]; then
    echo "=== Pre-checks ==="
    if ! eval "$PRECHECK_CMD" 2>&1; then
        echo "FATAL: pre-checks failed"
        exit 1
    fi
    echo "Pre-checks passed."
    echo ""
fi

# ── Step 2: Sync files to container ──────────────────────────────
sync_to_container

# ── Step 3: Ensure benchmark deps installed ──────────────────────
echo "=== Installing benchmark deps ==="
docker compose -f "$COMPOSE_FILE" exec "$CONTAINER" \
    pip install pytest-benchmark pytest-asyncio -q 2>/dev/null
echo ""

# ── Step 4: Benchmark (N runs, take best) ────────────────────────
echo "=== Benchmark: pipeline_us ($RUNS runs) ==="
run_benchmark "full_normalization_pipeline" "pipeline_us"
echo ""

echo "=== Benchmark: slice_us ($RUNS runs) ==="
run_benchmark "slice_image_speed" "slice_us"
echo ""

echo "=== Benchmark: darken_us ($RUNS runs) ==="
run_benchmark "darken_non_white_speed" "darken_us"
echo ""

echo "=== Done ==="
