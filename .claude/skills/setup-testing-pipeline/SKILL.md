---
name: setup-testing-pipeline
description: |
  Set up a comprehensive testing pipeline with Essential tier tests (required) and user-selected Recommended tier tests.
  Use when the user asks to "set up testing", "add CI tests", "create testing pipeline", or "configure test automation".
user_invocable: true
---

# Setup Testing Pipeline

This skill generates a comprehensive testing pipeline with CI/CD integration. It installs Essential tier tests automatically and lets the user pick from Recommended tier options.

References: Chapter 07 of the testing pipeline guide.

## Step 1: Gather Requirements

Present the two tiers to the user and ask which Recommended tests they want:

### Essential Tier (always included)

These are generated automatically -- no need to ask:

| Test Type | Purpose | Tool |
|-----------|---------|------|
| **Unit Tests** | Test individual functions and modules | Vitest |
| **Integration Tests** | Test service interactions and API calls | Vitest + MSW |
| **Type Checking** | Catch type errors at build time | TypeScript (`tsc --noEmit`) |
| **Linting** | Code quality and consistency | ESLint + Prettier |
| **E2E Tests** | Full user workflow testing | Playwright |
| **Contract Drift Detection** | Ensure frontend types match backend API | Custom script comparing OpenAPI spec |
| **Security Scanning** | Dependency vulnerability checks | npm audit / Snyk |
| **Accessibility** | a11y compliance testing | axe-core via Playwright |

### Recommended Tier (user chooses)

Ask the user which of these they want. List them with brief descriptions:

| Test Type | Purpose | Tool | Complexity |
|-----------|---------|------|------------|
| **Visual Regression** | Catch unintended UI changes via screenshot comparison | Playwright screenshots + Percy/Argos | Medium |
| **Property-Based Testing** | Generate random inputs to find edge cases | fast-check | Low |
| **API Fuzzing** | Send malformed requests to find API vulnerabilities | Schemathesis / custom scripts | Medium |
| **Load Testing** | Verify performance under concurrent users | k6 / Artillery | Medium |
| **Mutation Testing** | Verify test quality by introducing code mutations | Stryker | High |
| **Performance Testing** | Track Core Web Vitals and rendering performance | Lighthouse CI / web-vitals | Medium |
| **Bundle Size Tracking** | Prevent bundle size regressions | size-limit / bundlesize | Low |
| **WASM Testing** | Test client-side WASM processing pipeline | Vitest + canvas mocks | Medium |
| **Database Migration Testing** | Verify migrations run cleanly up and down | Alembic + pytest | Low |
| **Cross-Browser Testing** | Test on Chrome, Firefox, Safari | Playwright multi-browser | Low |

## Step 2: Generate CI Workflow

Generate `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: "20"
  PYTHON_VERSION: "3.11"

jobs:
  # ============================================================
  # ESSENTIAL TIER
  # ============================================================

  type-check:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: cd frontend && bun install --frozen-lockfile
      - run: cd frontend && npx tsc --noEmit

  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
      - run: cd frontend && bun install --frozen-lockfile
      - run: cd frontend && npx eslint src/ --max-warnings 0

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
      - run: pip install ruff
      - run: ruff check . && ruff format --check .

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Frontend unit tests
      - uses: oven-sh/setup-bun@v1
      - run: cd frontend && bun install --frozen-lockfile
      - run: cd frontend && npx vitest run --coverage

      # Backend unit tests
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
      - run: pip install -e ".[dev]"
      - run: pytest tests/unit/ -v --tb=short

      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-unit
          path: |
            frontend/coverage/
            htmlcov/

  integration-tests:
    name: Integration Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql+asyncpg://test:test@localhost:5432/test_db
      SECRET_KEY: test-secret-key-for-ci-only
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
      - run: pip install -e ".[web,dev]"
      - run: alembic upgrade head
      - run: pytest tests/integration/ -v --tb=short

  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql+asyncpg://test:test@localhost:5432/test_db
      SECRET_KEY: test-secret-key-for-ci-only
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
      - run: pip install -e ".[web,dev]"
      - run: alembic upgrade head

      - uses: oven-sh/setup-bun@v1
      - run: cd frontend && bun install --frozen-lockfile
      - run: npx playwright install --with-deps chromium

      - name: Start backend
        run: |
          uvicorn src.screenshot_processor.web.api.main:app \
            --host 127.0.0.1 --port 8002 &
          sleep 3

      - name: Start frontend
        run: |
          cd frontend && bun run dev &
          sleep 5

      - run: cd frontend && npx playwright test

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/playwright-report/

  contract-drift:
    name: Contract Drift Detection
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
      - run: pip install -e ".[web]"

      - uses: oven-sh/setup-bun@v1
      - run: cd frontend && bun install --frozen-lockfile

      - name: Generate fresh types and check for drift
        run: |
          cd frontend
          # Save current generated types
          cp src/types/api-schema.ts src/types/api-schema.ts.bak 2>/dev/null || true

          # Regenerate from live backend schema
          bun run generate:api-types

          # Compare
          if ! diff -q src/types/api-schema.ts src/types/api-schema.ts.bak > /dev/null 2>&1; then
            echo "::error::API contract drift detected! Frontend types are out of sync with backend schemas."
            echo "Run 'cd frontend && bun run generate:api-types' and commit the changes."
            diff src/types/api-schema.ts src/types/api-schema.ts.bak || true
            exit 1
          fi

          echo "No contract drift detected."

  security-scan:
    name: Security Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
      - run: cd frontend && bun install --frozen-lockfile
      - run: cd frontend && npm audit --audit-level=high || true

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
      - run: pip install pip-audit
      - run: pip install -e ".[web]"
      - run: pip-audit --strict || true

  accessibility:
    name: Accessibility
    runs-on: ubuntu-latest
    needs: [type-check, lint]
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql+asyncpg://test:test@localhost:5432/test_db
      SECRET_KEY: test-secret-key-for-ci-only
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
      - run: pip install -e ".[web,dev]"
      - run: alembic upgrade head

      - uses: oven-sh/setup-bun@v1
      - run: cd frontend && bun install --frozen-lockfile
      - run: npx playwright install --with-deps chromium

      - name: Start services
        run: |
          uvicorn src.screenshot_processor.web.api.main:app --host 127.0.0.1 --port 8002 &
          cd frontend && bun run dev &
          sleep 5

      - run: cd frontend && npx playwright test tests/accessibility/

  # ============================================================
  # RECOMMENDED TIER (uncomment what you need)
  # ============================================================

  # --- Visual Regression ---
  # visual-regression:
  #   name: Visual Regression
  #   runs-on: ubuntu-latest
  #   needs: [type-check]
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: oven-sh/setup-bun@v1
  #     - run: cd frontend && bun install --frozen-lockfile
  #     - run: npx playwright install --with-deps chromium
  #     - name: Start app
  #       run: |
  #         cd frontend && bun run dev &
  #         sleep 5
  #     - run: cd frontend && npx playwright test tests/visual/ --update-snapshots
  #     - uses: actions/upload-artifact@v4
  #       if: always()
  #       with:
  #         name: visual-snapshots
  #         path: frontend/tests/visual/__screenshots__/

  # --- Property-Based Testing ---
  # property-tests:
  #   name: Property-Based Tests
  #   runs-on: ubuntu-latest
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: oven-sh/setup-bun@v1
  #     - run: cd frontend && bun install --frozen-lockfile
  #     - run: cd frontend && npx vitest run tests/property/

  # --- API Fuzzing ---
  # api-fuzz:
  #   name: API Fuzzing
  #   runs-on: ubuntu-latest
  #   needs: [integration-tests]
  #   services:
  #     postgres:
  #       image: postgres:16
  #       env:
  #         POSTGRES_USER: test
  #         POSTGRES_PASSWORD: test
  #         POSTGRES_DB: test_db
  #       ports:
  #         - 5432:5432
  #       options: >-
  #         --health-cmd pg_isready
  #         --health-interval 10s
  #         --health-timeout 5s
  #         --health-retries 5
  #   env:
  #     DATABASE_URL: postgresql+asyncpg://test:test@localhost:5432/test_db
  #     SECRET_KEY: test-secret-key-for-ci-only
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: actions/setup-python@v5
  #       with:
  #         python-version: ${{ env.PYTHON_VERSION }}
  #     - run: pip install -e ".[web,dev]" schemathesis
  #     - run: alembic upgrade head
  #     - name: Start backend
  #       run: |
  #         uvicorn src.screenshot_processor.web.api.main:app --host 127.0.0.1 --port 8002 &
  #         sleep 3
  #     - run: schemathesis run http://127.0.0.1:8002/openapi.json --stateful=links

  # --- Load Testing ---
  # load-test:
  #   name: Load Testing
  #   runs-on: ubuntu-latest
  #   needs: [integration-tests]
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: grafana/setup-k6-action@v1
  #     - name: Start backend
  #       run: |
  #         # start services...
  #     - run: k6 run tests/load/scenarios.js

  # --- Mutation Testing ---
  # mutation-tests:
  #   name: Mutation Testing
  #   runs-on: ubuntu-latest
  #   needs: [unit-tests]
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: oven-sh/setup-bun@v1
  #     - run: cd frontend && bun install --frozen-lockfile
  #     - run: cd frontend && npx stryker run

  # --- Performance ---
  # performance:
  #   name: Performance
  #   runs-on: ubuntu-latest
  #   needs: [e2e-tests]
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: treosh/lighthouse-ci-action@v11
  #       with:
  #         urls: http://localhost:5175
  #         uploadArtifacts: true

  # --- Bundle Size ---
  # bundle-size:
  #   name: Bundle Size
  #   runs-on: ubuntu-latest
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: oven-sh/setup-bun@v1
  #     - run: cd frontend && bun install --frozen-lockfile
  #     - run: cd frontend && bun run build
  #     - uses: andresz1/size-limit-action@v1
  #       with:
  #         github_token: ${{ secrets.GITHUB_TOKEN }}
  #         directory: frontend

  # --- WASM Testing ---
  # wasm-tests:
  #   name: WASM Tests
  #   runs-on: ubuntu-latest
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: oven-sh/setup-bun@v1
  #     - run: cd frontend && bun install --frozen-lockfile
  #     - run: cd frontend && npx vitest run tests/wasm/

  # --- Cross-Browser ---
  # cross-browser:
  #   name: Cross-Browser E2E
  #   runs-on: ubuntu-latest
  #   needs: [e2e-tests]
  #   strategy:
  #     matrix:
  #       browser: [chromium, firefox, webkit]
  #   steps:
  #     - uses: actions/checkout@v4
  #     - uses: oven-sh/setup-bun@v1
  #     - run: cd frontend && bun install --frozen-lockfile
  #     - run: npx playwright install --with-deps ${{ matrix.browser }}
  #     - run: cd frontend && npx playwright test --project=${{ matrix.browser }}
```

## Step 3: Generate Playwright Config

Generate or update `frontend/playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["html", { open: "never" }],
    ["list"],
    ...(process.env.CI ? [["github" as const]] : []),
  ],
  use: {
    baseURL: "http://localhost:5175",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Uncomment for cross-browser testing:
    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },
    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },
    {
      name: "accessibility",
      testDir: "./tests/accessibility",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "bun run dev",
        port: 5175,
        reuseExistingServer: true,
      },
});
```

## Step 4: Generate Sample Test Files

### Unit test sample

Generate `frontend/tests/unit/example.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("Example Unit Test", () => {
  it("should pass a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("should handle async operations", async () => {
    const result = await Promise.resolve("hello");
    expect(result).toBe("hello");
  });
});
```

### E2E test sample

Generate `frontend/tests/e2e/example.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Example E2E Test", () => {
  test("should load the homepage", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
  });
});
```

### Accessibility test sample

Generate `frontend/tests/accessibility/a11y.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Accessibility", () => {
  test("homepage should have no critical a11y violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );

    if (critical.length > 0) {
      console.error(
        "A11y violations:",
        critical.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.length,
        }))
      );
    }

    expect(critical).toHaveLength(0);
  });
});
```

## Step 5: Generate Contract Drift Script

Generate `frontend/scripts/check-contract-drift.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Check for contract drift between backend OpenAPI spec and frontend types
echo "Checking for API contract drift..."

TYPES_FILE="src/types/api-schema.ts"

if [ ! -f "$TYPES_FILE" ]; then
  echo "ERROR: $TYPES_FILE not found. Run 'bun run generate:api-types' first."
  exit 1
fi

# Save current
cp "$TYPES_FILE" "${TYPES_FILE}.bak"

# Regenerate
bun run generate:api-types

# Compare
if ! diff -q "$TYPES_FILE" "${TYPES_FILE}.bak" > /dev/null 2>&1; then
  echo "DRIFT DETECTED: Frontend types are out of sync with backend schemas."
  echo ""
  echo "Changes:"
  diff "$TYPES_FILE" "${TYPES_FILE}.bak" || true
  echo ""
  echo "Fix: run 'cd frontend && bun run generate:api-types' and commit the result."
  rm "${TYPES_FILE}.bak"
  exit 1
fi

rm "${TYPES_FILE}.bak"
echo "No contract drift detected."
```

Make it executable:
```bash
chmod +x frontend/scripts/check-contract-drift.sh
```

## Step 6: Install Dependencies

Based on the user's selections, install the required dev dependencies:

### Always needed (Essential tier)

```bash
cd frontend && bun add -d \
  vitest \
  @vitest/coverage-v8 \
  @playwright/test \
  @axe-core/playwright \
  eslint \
  prettier
```

### Per Recommended tier selection

| Selection | Install command |
|-----------|----------------|
| Property-Based | `bun add -d fast-check` |
| Mutation Testing | `bun add -d @stryker-mutator/core @stryker-mutator/vitest-runner` |
| Bundle Size | `bun add -d size-limit @size-limit/preset-app` |
| Visual Regression | (uses Playwright built-in screenshots -- no extra deps) |
| Performance | `bun add -d @lhci/cli` |

## Step 7: Add package.json Scripts

Add or merge these scripts into `frontend/package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:debug": "playwright test --debug",
    "test:a11y": "playwright test --project=accessibility",
    "lint": "eslint src/ --max-warnings 0",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "format:check": "prettier --check src/",
    "type-check": "tsc --noEmit",
    "check-drift": "./scripts/check-contract-drift.sh"
  }
}
```

## Step 8: Uncomment Selected Recommended Jobs

For each Recommended tier test the user selected, uncomment the corresponding job block in the CI workflow. Update the `needs` arrays if dependencies change.

## Step 9: Verify Setup

Run these commands to verify everything works:

```bash
# Type checking
cd frontend && npx tsc --noEmit

# Unit tests
cd frontend && npx vitest run

# Lint
cd frontend && npx eslint src/ --max-warnings 0 || echo "Lint issues found (expected for new setup)"

# E2E smoke test (if app can be started)
cd frontend && npx playwright test --grep "example" || echo "E2E tests need running services"
```

Report results and fix any issues before finishing.

## Decision Summary

After completing, print a summary:

```
Testing Pipeline Setup Complete
================================

Essential Tier (enabled):
  [x] Unit Tests (Vitest)
  [x] Integration Tests (Vitest + MSW)
  [x] Type Checking (tsc)
  [x] Linting (ESLint + Prettier)
  [x] E2E Tests (Playwright)
  [x] Contract Drift Detection
  [x] Security Scanning (npm audit + pip-audit)
  [x] Accessibility (axe-core)

Recommended Tier:
  [x/--] Visual Regression
  [x/--] Property-Based Testing
  ... (list user's selections)

Files generated:
  - .github/workflows/ci.yml
  - frontend/playwright.config.ts
  - frontend/tests/unit/example.test.ts
  - frontend/tests/e2e/example.spec.ts
  - frontend/tests/accessibility/a11y.spec.ts
  - frontend/scripts/check-contract-drift.sh

Next steps:
  1. Commit and push to trigger CI
  2. Replace sample tests with real tests for your application
  3. Configure any external services (Percy, Snyk, etc.)
```
