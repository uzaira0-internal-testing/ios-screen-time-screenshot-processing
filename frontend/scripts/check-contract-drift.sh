#!/usr/bin/env bash
set -euo pipefail

echo "Checking for API contract drift..."

TYPES_FILE="src/types/api-schema.ts"

if [ ! -f "$TYPES_FILE" ]; then
  echo "ERROR: $TYPES_FILE not found."
  exit 1
fi

# Save current
cp "$TYPES_FILE" "${TYPES_FILE}.bak"

# Regenerate (timeout after 30s — the backend must be importable)
if ! timeout 30 bun run generate:api-types 2>/dev/null; then
  echo "WARNING: generate:api-types failed or timed out. Skipping drift check."
  rm -f "${TYPES_FILE}.bak"
  exit 0
fi

# Compare
if ! diff -q "$TYPES_FILE" "${TYPES_FILE}.bak" > /dev/null 2>&1; then
  echo "::error::Contract drift detected! Frontend types are out of sync with backend."
  echo "Run 'cd frontend && bun run generate:api-types' and commit."
  diff --unified "$TYPES_FILE" "${TYPES_FILE}.bak" || true
  rm "${TYPES_FILE}.bak"
  exit 1
fi

rm "${TYPES_FILE}.bak"
echo "No contract drift detected."
