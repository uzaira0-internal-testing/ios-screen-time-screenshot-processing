#!/usr/bin/env bash
# Autoresearch benchmark runner for Rust image processing pipeline
# Runs: cargo test (correctness gate) → cargo bench (Criterion, 3 runs, take best)
# Outputs METRIC lines for the agent to parse
# Exit code 0 = all good, non-zero = broken
set -euo pipefail

cd "$(dirname "$0")/.."
TAURI_DIR="frontend/src-tauri"

# ── Configuration ─────────────────────────────────────────────────
RUNS=3

# ── Step 1: Correctness gate ─────────────────────────────────────
echo "=== Running cargo test (correctness gate) ==="
if ! (cd "$TAURI_DIR" && cargo test --lib 2>&1); then
    echo "FAIL: cargo test failed — fix tests before benchmarking"
    exit 1
fi
echo "PASS: all tests green"

# ── Step 2: Build release mode ────────────────────────────────────
echo "=== Building release mode ==="
(cd "$TAURI_DIR" && cargo build --release 2>&1)

# ── Step 3: Run Criterion benchmarks ─────────────────────────────
echo "=== Running Criterion benchmarks ($RUNS runs, take best) ==="

run_bench() {
    local bench_name="$1"
    local metric_name="$2"

    local BEST=999999999
    for run in $(seq 1 "$RUNS"); do
        # Run criterion bench and extract time from output
        local output
        output=$(cd "$TAURI_DIR" && cargo bench --bench "$bench_name" 2>&1 || true)

        # Parse Criterion output: "time:   [X.XXX µs Y.YYY µs Z.ZZZ µs]"
        # Extract the middle value (estimate)
        local time_us
        time_us=$(echo "$output" | grep -oP 'time:\s+\[\S+\s+(\S+)\s+(µs|ms|ns)' | head -1 | awk '{
            val=$2; unit=$3
            if (unit == "ms") val = val * 1000
            else if (unit == "ns") val = val / 1000
            printf "%.0f", val
        }')

        if [ -n "$time_us" ] && [ "$time_us" -lt "$BEST" ] 2>/dev/null; then
            BEST="$time_us"
        fi
    done

    if [ "$BEST" -lt 999999999 ]; then
        echo "METRIC ${metric_name}=${BEST}"
    else
        echo "WARN: Could not extract benchmark time for $bench_name"
    fi
}

# Run each benchmark suite
# These bench targets will be created after the first optimization iteration
if [ -f "$TAURI_DIR/benches/processing_benchmark.rs" ]; then
    run_bench "processing_benchmark" "pipeline_us"
else
    echo "SKIP: No processing_benchmark bench target found yet"
    echo "METRIC pipeline_us=0"
fi

# If scan_benchmark exists (existing), run it too
if [ -f "$TAURI_DIR/benches/scan_benchmark.rs" ]; then
    run_bench "scan_benchmark" "scan_us"
fi

echo "=== Benchmark complete ==="
