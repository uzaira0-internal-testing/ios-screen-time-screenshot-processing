---
name: testing-encyclopedia
description: "Universal testing encyclopedia: a comprehensive catalog of every testing type organized by class. Adapts to any technology stack -- ask for your stack and get tailored recommendations, setup instructions, example configs, and CI workflows."
user_invocable: true
---

# Testing Encyclopedia

A comprehensive, stack-agnostic testing catalog. This skill is NOT tied to any specific project -- it adapts to whatever technology stack you are working with.

## When Invoked

Follow this sequence:

### Step 1: Gather Context

Ask the user:

1. **What is your stack?**
   - Language(s): TypeScript, Python, Rust, Go, Java, C#, etc.
   - Framework(s): React, FastAPI, Django, Next.js, Actix, Spring Boot, etc.
   - Test runner(s) already in use: pytest, vitest, jest, bun:test, cargo test, etc.
   - CI provider: GitHub Actions, GitLab CI, CircleCI, Jenkins, etc.
   - Package manager: npm, bun, pnpm, yarn, pip, uv, cargo, go modules, etc.

2. **What testing do you already have?**
   - Which test types are currently set up?
   - Approximate coverage level (none, minimal, moderate, comprehensive)?
   - Any specific pain points or gaps they are aware of?

### Step 2: Present the Catalog

Filter the full catalog below to the user's stack. For each class, mark each type as:
- **Essential** -- every project should have this
- **Recommended** -- high value, set up when resources allow
- **Advanced** -- for mature projects with specific needs

### Step 3: Generate Setup

For each type the user wants to add:
1. Installation commands
2. Minimal configuration file
3. Example test file
4. CI job definition
5. Integration notes (how it interacts with other test types)

### Step 4: Generate CI Workflow

Produce a complete CI workflow file (GitHub Actions YAML, GitLab CI YAML, etc.) with all selected test types as parallel jobs where possible, with proper dependency ordering.

---

## Full Testing Catalog

### Class: Correctness

Tests that verify your code does what it should.

#### Unit Tests [Essential]

Verify individual functions, methods, or classes in isolation.

| Stack | Libraries | Runner Command |
|-------|-----------|---------------|
| Python | pytest, unittest | `pytest tests/unit/ -v` |
| TypeScript/JS | vitest, jest, bun:test | `vitest run`, `jest`, `bun test` |
| Rust | built-in #[test] | `cargo test` |
| Go | built-in testing | `go test ./...` |
| Java | JUnit 5, TestNG | `mvn test`, `gradle test` |
| C# | xUnit, NUnit, MSTest | `dotnet test` |

**Setup pattern (pytest):**
```bash
pip install pytest pytest-cov
```
```ini
# pyproject.toml
[tool.pytest.ini_options]
testpaths = ["tests/unit"]
addopts = "--strict-markers -v"
```

**Setup pattern (vitest):**
```bash
bun add -D vitest @vitest/coverage-v8
```
```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
  },
});
```

#### Integration Tests [Essential]

Verify that components work together correctly (API routes + database, services + external APIs).

| Stack | Libraries |
|-------|-----------|
| Python | pytest + httpx.AsyncClient, testcontainers-python |
| TypeScript/JS | supertest, vitest + fetch mocking |
| Rust | actix-web::test, reqwest + testcontainers |
| Go | net/http/httptest, testcontainers-go |
| Java | Spring Boot Test, Testcontainers |

**Key principle:** Use real databases via testcontainers rather than mocks for database integration tests. Mocks drift from real behavior.

```python
# Example: FastAPI integration test with real PostgreSQL
import pytest
from httpx import AsyncClient, ASGITransport
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def postgres():
    with PostgresContainer("postgres:16") as pg:
        yield pg.get_connection_url()

async def test_create_item(app, postgres):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/items", json={"name": "test"})
        assert response.status_code == 201
```

#### End-to-End (E2E) Tests [Essential]

Verify complete user workflows through the real UI.

| Stack | Libraries |
|-------|-----------|
| Web | Playwright, Cypress, Selenium |
| Mobile | Detox (React Native), XCTest (iOS), Espresso (Android) |
| Desktop | Tauri WebDriver, WebdriverIO, Spectron (Electron) |
| API-only | pytest + httpx, supertest, RestAssured |

**Playwright setup:**
```bash
bun add -D @playwright/test
bunx playwright install chromium
```
```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:5175" },
  webServer: { command: "bun run dev", port: 5175 },
});
```

#### Snapshot Tests [Recommended]

Capture output and compare against stored references. Catches unintentional changes.

| Stack | Libraries |
|-------|-----------|
| Python | pytest-syrupy, snapshottest |
| TypeScript/JS | vitest toMatchSnapshot(), jest snapshots |
| Rust | insta |
| Go | cupaloy |

**When to use:** API response shapes, serialized data structures, CLI output, rendered component HTML. Avoid for frequently-changing output.

#### Contract / API Tests [Recommended]

Verify that API endpoints conform to their OpenAPI/GraphQL/Protobuf schema.

| Approach | Libraries |
|----------|-----------|
| Schema-driven (fuzzing) | Schemathesis (OpenAPI), Dredd |
| Consumer-driven contracts | Pact (any language), Spring Cloud Contract |
| Schema diff detection | openapi-diff, oasdiff, buf breaking (Protobuf) |

**Schemathesis example:**
```bash
pip install schemathesis
schemathesis run http://localhost:8002/openapi.json --checks all
```

#### Property-Based Tests [Recommended]

Generate random inputs to find edge cases that hand-written tests miss.

| Stack | Libraries |
|-------|-----------|
| Python | Hypothesis |
| TypeScript/JS | fast-check |
| Rust | proptest, quickcheck |
| Go | rapid |
| Haskell | QuickCheck |
| Java | jqwik |

```python
from hypothesis import given, strategies as st

@given(st.lists(st.integers()))
def test_sort_is_idempotent(xs):
    assert sorted(sorted(xs)) == sorted(xs)
```

#### Mutation Tests [Advanced]

Inject small bugs (mutations) into your code and verify that tests catch them. Measures test suite effectiveness beyond line coverage.

| Stack | Libraries |
|-------|-----------|
| Python | mutmut, cosmic-ray |
| TypeScript/JS | Stryker |
| Rust | cargo-mutants |
| Java | PIT (pitest) |
| Go | go-mutesting |

```bash
# Python
mutmut run --paths-to-mutate=src/

# TypeScript
npx stryker run
```

**Warning:** Mutation testing is slow (runs your test suite once per mutation). Start with a small critical module, not the entire codebase.

#### Fuzz Tests [Advanced]

Generate malformed/random inputs to find crashes, hangs, and security vulnerabilities.

| Stack | Libraries |
|-------|-----------|
| API | Schemathesis (OpenAPI fuzzing) |
| Python | atheris, python-afl |
| Rust | cargo-fuzz (libFuzzer), afl.rs |
| Go | go-fuzz (built into `go test`) |
| Java | Jazzer |
| C/C++ | AFL++, libFuzzer, Honggfuzz |

#### Cross-Implementation Parity Tests [Advanced]

When you have the same algorithm in two languages (e.g., Python backend and TypeScript/WASM frontend), verify they produce identical results.

**Pattern:** Generate test vectors from one implementation, save as JSON fixtures, run both implementations against the same fixtures, assert identical output.

```python
# Generate fixtures from Python (source of truth)
import json
test_cases = [{"input": img, "expected": process(img)} for img in samples]
Path("fixtures/parity.json").write_text(json.dumps(test_cases))
```
```typescript
// Verify TypeScript implementation matches
import fixtures from "./fixtures/parity.json";
for (const { input, expected } of fixtures) {
  expect(wasmProcess(input)).toEqual(expected);
}
```

#### Database Migration Tests [Recommended]

Verify that migrations can be applied, rolled back, and re-applied without data loss.

| Stack | Libraries |
|-------|-----------|
| Python/SQLAlchemy | Alembic API: `upgrade()`, `downgrade()`, `upgrade()` |
| Java | Flyway verify, Liquibase validate |
| Node.js | Knex migrate:latest + migrate:rollback |
| Go | golang-migrate, goose |
| Rust | diesel migrations, sqlx migrate |

```python
# Test: upgrade -> downgrade -> upgrade (idempotency)
from alembic.command import upgrade, downgrade
from alembic.config import Config

def test_migration_roundtrip(alembic_config):
    upgrade(alembic_config, "head")
    downgrade(alembic_config, "base")
    upgrade(alembic_config, "head")  # Must not fail
```

#### Golden File Tests [Recommended]

Serialize complex output and compare against checked-in `.golden` files. Similar to snapshots but stored as separate files for easier review in PRs.

**Pattern:**
1. Run function, serialize output to string
2. Compare against `tests/golden/{test_name}.golden`
3. If `--update-golden` flag is set, overwrite the golden file
4. In CI, fail if output differs from golden file

### Class: Type Safety

Tests that catch type errors at build time.

#### Static Type Checking [Essential]

| Stack | Tool | Command |
|-------|------|---------|
| TypeScript | tsc | `tsc --noEmit` |
| Python | basedpyright | `basedpyright` |
| Python | mypy | `mypy src/` |
| Python | pyright | `pyright` |
| Rust | cargo check | `cargo check` |
| Go | go vet | `go vet ./...` |

**TypeScript strict flags (recommended):**
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

#### Contract Drift Detection [Recommended]

Detect when backend API schemas and frontend types diverge.

| Approach | Tool |
|----------|------|
| OpenAPI type generation | openapi-typescript, openapi-fetch |
| Schema diff in CI | `openapi-diff old.json new.json` |
| Consumer-driven | Pact broker with can-i-deploy |

**CI pattern:**
```bash
# Regenerate types, fail if there are uncommitted changes
bun run generate:api-types
git diff --exit-code frontend/src/types/api-schema.ts || \
  (echo "API types are stale. Run 'bun run generate:api-types' and commit." && exit 1)
```

#### Schema Validation [Recommended]

Runtime validation of data at system boundaries (API inputs, config files, external API responses).

| Stack | Libraries |
|-------|-----------|
| TypeScript | Zod, AJV, io-ts, Valibot |
| Python | Pydantic, marshmallow, attrs + cattrs |
| Rust | serde + validator |
| Go | go-playground/validator |
| Java | Jakarta Bean Validation (Hibernate Validator) |

### Class: Code Quality

Tests that enforce code standards and maintainability.

#### Linting [Essential]

| Stack | Libraries | Command |
|-------|-----------|---------|
| TypeScript/JS | ESLint, Biome, oxlint | `eslint .`, `biome check .` |
| Python | ruff, flake8, pylint | `ruff check .` |
| Rust | clippy | `cargo clippy -- -D warnings` |
| Go | golangci-lint | `golangci-lint run` |
| Java | SpotBugs, Error Prone, Checkstyle | `mvn spotbugs:check` |
| C# | dotnet-format, Roslyn analyzers | `dotnet format --verify-no-changes` |

#### Code Formatting [Essential]

| Stack | Libraries | Command |
|-------|-----------|---------|
| TypeScript/JS | Prettier, Biome | `prettier --check .`, `biome format .` |
| Python | ruff format, Black | `ruff format --check .` |
| Rust | rustfmt | `cargo fmt -- --check` |
| Go | gofmt, goimports | `gofmt -l .` |
| Java | google-java-format, Spotless | `mvn spotless:check` |

#### Complexity Analysis [Recommended]

Flag functions that are too complex to maintain.

| Stack | Libraries |
|-------|-----------|
| TypeScript/JS | eslint-plugin-complexity, ESLint max-complexity rule |
| Python | radon, cognitive-complexity, wily |
| Rust | clippy cognitive_complexity |
| Go | gocyclo |
| Java | PMD |

#### Dead Code Detection [Recommended]

Find unused exports, variables, imports, and dependencies.

| Stack | Libraries |
|-------|-----------|
| TypeScript | ts-prune, knip |
| Python | vulture, dead |
| Rust | cargo-udeps (unused deps), cargo-deadlinks |
| Go | unused (via golangci-lint) |
| Java | Spotless, IntelliJ inspections |

#### Dependency Analysis [Recommended]

Find unused, outdated, or duplicate dependencies.

| Stack | Libraries |
|-------|-----------|
| TypeScript/JS | depcheck, knip, npm-check-updates |
| Python | deptry, pip-audit, pipdeptree |
| Rust | cargo-deny, cargo-udeps |
| Go | go mod tidy + go mod verify |

### Class: Security

Tests that find vulnerabilities before they reach production.

#### Dependency Scanning [Essential]

| Stack | Libraries |
|-------|-----------|
| TypeScript/JS | npm audit, Snyk, Socket |
| Python | pip-audit, safety, Snyk |
| Rust | cargo-audit |
| Go | govulncheck |
| Multi-language | Dependabot, Renovate, Trivy fs |
| Java | OWASP Dependency-Check |

**CI pattern (GitHub Actions):**
```yaml
- name: Audit dependencies
  run: |
    npm audit --audit-level=high
    pip-audit --strict
```

#### SAST (Static Application Security Testing) [Recommended]

| Tool | Languages | Notes |
|------|-----------|-------|
| Semgrep | 20+ languages | Fast, customizable rules, free tier |
| CodeQL | 10+ languages | GitHub-native, deep analysis, slower |
| Bandit | Python | Python-specific security linter |
| eslint-plugin-security | JavaScript/TS | Finds common JS security anti-patterns |
| cargo-audit + clippy | Rust | Dependency + code-level checks |
| gosec | Go | Go security linter |

```bash
# Semgrep
semgrep --config=auto --error .

# Bandit
bandit -r src/ -ll
```

#### Container Scanning [Recommended]

| Tool | Notes |
|------|-------|
| Trivy | Fast, comprehensive, supports OS + language packages |
| Grype | Anchore's scanner, good SBOM support |
| Docker Scout | Docker-native, integrated into Docker Desktop |
| Snyk Container | Commercial, good CI integration |

```bash
trivy image --severity HIGH,CRITICAL my-app:latest
```

#### Secret Detection [Essential]

| Tool | Notes |
|------|-------|
| gitleaks | Fast, scans git history + staged changes |
| truffleHog | Deep history scanning, verified secrets |
| detect-secrets | Baseline-based (tracks known secrets) |
| GitHub Secret Scanning | Automatic for public repos, available for private |

```bash
# Pre-commit hook
gitleaks protect --staged

# CI scan
gitleaks detect --source . --verbose
```

#### License Compliance [Recommended]

| Stack | Libraries |
|-------|-----------|
| TypeScript/JS | license-checker, license-report |
| Python | pip-licenses |
| Rust | cargo-license, cargo-deny licenses |
| Go | go-licenses |
| Multi-language | FOSSA, Snyk license |

#### DAST (Dynamic Application Security Testing) [Advanced]

| Tool | Notes |
|------|-------|
| OWASP ZAP | Full-featured proxy scanner, free |
| Nuclei | Template-based, fast, community templates |
| Nikto | Web server scanner |
| Burp Suite | Commercial, industry standard |

### Class: Performance

Tests that prevent performance regressions.

#### Load Testing [Recommended]

| Tool | Language | Notes |
|------|----------|-------|
| k6 | JavaScript | Grafana ecosystem, scriptable, good CI support |
| Locust | Python | Distributed, real-time web UI |
| Artillery | JavaScript/YAML | Config-driven, good for CI |
| Gatling | Scala/Java | JVM-based, detailed reports |
| wrk/wrk2 | C | Simple HTTP benchmarking |

```javascript
// k6 example
import http from "k6/http";
import { check, sleep } from "k6";

export const options = { vus: 50, duration: "30s" };

export default function () {
  const res = http.get("http://localhost:8002/api/v1/screenshots/stats");
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(1);
}
```

#### Performance Regression [Recommended]

| Tool | What it measures |
|------|-----------------|
| Lighthouse CI | Web vitals (LCP, CLS, TBT, etc.) |
| WebPageTest API | Real browser performance metrics |
| Clinic.js | Node.js profiling (CPU, memory, I/O) |
| hyperfine | CLI command benchmarking |

```bash
# Lighthouse CI
lhci autorun --config=lighthouserc.json
```

#### Bundle Size Monitoring [Recommended]

| Tool | Notes |
|------|-------|
| size-limit | Budget-based, fails CI if bundle exceeds limit |
| bundlewatch | Tracks size changes across PRs |
| webpack-bundle-analyzer | Visual treemap of bundle contents |
| source-map-explorer | Analyze what is in your bundle |
| Vite's built-in reporting | `vite build --report` |

```json
// package.json (size-limit)
{
  "size-limit": [
    { "path": "dist/**/*.js", "limit": "250 KB" }
  ]
}
```

#### Benchmark Tests [Recommended]

| Stack | Libraries |
|-------|-----------|
| Python | pytest-benchmark, pyperf |
| TypeScript/JS | tinybench, vitest bench mode |
| Rust | criterion, divan |
| Go | testing.B (built-in) |
| Java | JMH |
| C/C++ | Google Benchmark |

```python
# pytest-benchmark
def test_sort_performance(benchmark):
    data = list(range(10000, 0, -1))
    result = benchmark(sorted, data)
    assert result == sorted(data)
```

#### Memory Profiling [Advanced]

| Stack | Libraries |
|-------|-----------|
| Python | memray, tracemalloc, memory-profiler |
| TypeScript/JS | Chrome DevTools protocol, clinic.js heapprofile |
| Rust | DHAT, heaptrack |
| Go | pprof (built-in) |
| Java | async-profiler, JFR |

### Class: User Experience

Tests that verify the app works well for real users.

#### Accessibility (a11y) [Essential for web apps]

| Tool | Integration |
|------|------------|
| @axe-core/playwright | Playwright test integration |
| pa11y | CLI and CI runner |
| Lighthouse a11y | Part of Lighthouse audits |
| @axe-core/react | React development-time warnings |
| eslint-plugin-jsx-a11y | Lint-time a11y checks |

```typescript
// Playwright + axe-core
import AxeBuilder from "@axe-core/playwright";

test("homepage is accessible", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

#### Visual Regression [Recommended]

| Tool | Notes |
|------|-------|
| Playwright `toHaveScreenshot()` | Built-in, no extra service needed |
| Chromatic | Storybook-based, hosted comparison |
| Percy | BrowserStack-owned, hosted comparison |
| BackstopJS | Open-source, Docker-based |
| Storybook test-runner | Component-level visual testing |

```typescript
// Playwright visual regression
test("dashboard looks correct", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveScreenshot("dashboard.png", {
    maxDiffPixelRatio: 0.01,
  });
});
```

#### Cross-Browser Testing [Recommended]

| Tool | Notes |
|------|-------|
| Playwright | Chromium, Firefox, WebKit (Safari) built-in |
| BrowserStack | Real device cloud |
| Sauce Labs | Real device cloud |
| LambdaTest | Real device cloud |

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
```

#### Responsive Testing [Recommended]

| Tool | Notes |
|------|-------|
| Playwright viewports | Test at multiple screen sizes |
| Storybook viewports addon | Component-level viewport testing |
| Chromatic responsive | Automated multi-viewport snapshots |

```typescript
// Playwright viewport testing
const viewports = [
  { width: 375, height: 812, name: "iPhone" },
  { width: 768, height: 1024, name: "iPad" },
  { width: 1920, height: 1080, name: "Desktop" },
];
for (const vp of viewports) {
  test(`renders at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(page).toHaveScreenshot(`home-${vp.name}.png`);
  });
}
```

### Class: Infrastructure

Tests that verify your deployment and infrastructure.

#### CI Pipeline Testing [Recommended]

| Tool | Notes |
|------|-------|
| act | Run GitHub Actions locally |
| gitlab-ci-local | Run GitLab CI locally |
| dagger | Portable CI pipelines (run anywhere) |

```bash
# Test GitHub Actions locally
act push --job test
```

#### Docker Build Testing [Recommended]

| Tool | Notes |
|------|-------|
| container-structure-test | Verify container contents, commands, metadata |
| Dive | Analyze image layers for wasted space |
| Hadolint | Lint Dockerfiles |
| Docker build --check | Built-in Dockerfile linting (BuildKit) |

```yaml
# container-structure-test
schemaVersion: "2.0.0"
fileExistenceTests:
  - name: "App binary exists"
    path: "/app/server"
    shouldExist: true
commandTests:
  - name: "Server starts"
    command: "/app/server"
    args: ["--version"]
    expectedOutput: ["v\\d+\\.\\d+"]
```

#### IaC Testing [Recommended]

| Tool | IaC Type |
|------|----------|
| Checkov | Terraform, CloudFormation, Kubernetes, Docker |
| tflint | Terraform |
| cfn-lint | CloudFormation |
| kubeconform | Kubernetes YAML |
| OPA/Rego | Policy as code (any) |

#### Smoke Tests [Essential]

Simple health checks that verify a deployment is alive and serving traffic.

```bash
#!/bin/bash
# smoke-test.sh
set -euo pipefail

BASE_URL="${1:-http://localhost:8002}"

# Health check
curl -sf "$BASE_URL/health" | jq -e '.status == "ok"'

# API responds
curl -sf "$BASE_URL/api/v1/screenshots/stats" | jq -e '.total >= 0'

echo "Smoke tests passed"
```

#### Canary / Synthetic Monitoring [Advanced]

| Tool | Notes |
|------|-------|
| Datadog Synthetics | Commercial, full browser + API tests |
| Checkly | Playwright-based monitoring |
| Playwright on schedule | Free -- run your E2E suite on a cron |
| Uptime Kuma | Open-source uptime monitoring |

### Class: Platform-Specific (Tauri / Desktop)

Tests specific to Tauri desktop applications.

#### Tauri Command Tests [Essential]

Test Rust `#[tauri::command]` handlers as regular Rust unit tests.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet() {
        let result = greet("World".to_string());
        assert_eq!(result, "Hello, World!");
    }
}
```

#### Update Signing Verification [Recommended]

CI assertions that release artifacts have valid `.sig` files.

```bash
# In CI after build
test -f "target/release/bundle/macos/MyApp.app.tar.gz.sig" || \
  (echo "Missing update signature!" && exit 1)
```

#### Desktop E2E [Recommended]

| Tool | Notes |
|------|-------|
| Tauri WebDriver | Official, uses WebDriver protocol |
| WebdriverIO | General-purpose, works with Tauri |

#### WASM Processing Tests [Recommended]

| Approach | Tool |
|----------|------|
| Rust unit tests | `wasm-pack test --node` or `--headless` |
| Browser integration | Playwright with WASM mode enabled |

```bash
# Test WASM module in headless browser
wasm-pack test --headless --chrome
```

#### Web Worker Tests [Recommended]

| Approach | When |
|----------|------|
| Import functions directly | Unit test the processing logic without the worker shell |
| Playwright integration | Test the full worker message flow in a real browser |

```typescript
// Unit test: import the processing function directly (not the worker)
import { processImage } from "./workers/processing.logic";

test("processImage extracts grid", () => {
  const result = processImage(testImageData);
  expect(result.bars).toHaveLength(24);
});
```

---

## CI Workflow Templates

### GitHub Actions (Full Stack)

```yaml
name: CI
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint Python
        run: ruff check . && ruff format --check .
      - name: Lint TypeScript
        run: cd frontend && bun install && bun run lint

  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Python type check
        run: basedpyright src/
      - name: TypeScript type check
        run: cd frontend && bun install && npx tsc --noEmit

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Python unit tests
        run: pytest tests/unit/ -v --cov=src --cov-report=xml
      - name: Frontend unit tests
        run: cd frontend && bun install && bun test

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - name: Integration tests
        run: pytest tests/integration/ -v

  e2e-tests:
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    steps:
      - uses: actions/checkout@v4
      - name: Install Playwright
        run: cd frontend && bun install && bunx playwright install --with-deps chromium
      - name: E2E tests
        run: cd frontend && bun run test:e2e

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Dependency audit
        run: |
          pip-audit --strict
          cd frontend && npm audit --audit-level=high
      - name: Secret scanning
        run: gitleaks detect --source . --verbose
      - name: SAST
        run: semgrep --config=auto --error .

  performance:
    runs-on: ubuntu-latest
    needs: [unit-tests]
    steps:
      - uses: actions/checkout@v4
      - name: Bundle size check
        run: cd frontend && bun install && bun run build && npx size-limit
```

### GitLab CI (Full Stack)

```yaml
stages:
  - lint
  - test
  - security
  - e2e

lint:
  stage: lint
  script:
    - ruff check . && ruff format --check .
    - cd frontend && npm ci && npx tsc --noEmit

unit-tests:
  stage: test
  script:
    - pytest tests/unit/ -v --junitxml=report.xml
  artifacts:
    reports:
      junit: report.xml

integration-tests:
  stage: test
  services:
    - postgres:16
  variables:
    POSTGRES_PASSWORD: test
  script:
    - pytest tests/integration/ -v

security-scan:
  stage: security
  script:
    - pip-audit --strict
    - semgrep --config=auto --error .
    - gitleaks detect --source .

e2e-tests:
  stage: e2e
  needs: [unit-tests, integration-tests]
  script:
    - cd frontend && npm ci && npx playwright install --with-deps chromium
    - npm run test:e2e
```

---

## Prioritization Guide

When a project has no tests, add them in this order:

| Priority | Type | Why |
|----------|------|-----|
| 1 | Linting + Formatting | Zero effort, catches bugs immediately, enforces consistency |
| 2 | Static Type Checking | Catches a whole class of bugs at build time |
| 3 | Unit Tests | Fast feedback, easy to write, high coverage potential |
| 4 | Secret Detection | Prevents credential leaks (irreversible damage) |
| 5 | Integration Tests | Catches bugs that unit tests miss (real DB, real HTTP) |
| 6 | Dependency Scanning | Catches known CVEs in your supply chain |
| 7 | E2E Tests | Catches user-facing regressions |
| 8 | Smoke Tests | Verifies deployments work |
| 9 | Contract/API Tests | Prevents frontend-backend drift |
| 10 | Visual Regression | Catches UI regressions |
| 11+ | Everything else | Based on project-specific needs |

## Coverage Targets

| Metric | Minimum | Good | Excellent |
|--------|---------|------|-----------|
| Line coverage | 60% | 80% | 90%+ |
| Branch coverage | 40% | 70% | 85%+ |
| Mutation score | -- | 60% | 80%+ |
| Lighthouse a11y | 70 | 90 | 100 |
| Lighthouse perf | 50 | 80 | 95+ |

**Important:** Coverage is a lagging indicator. High coverage with bad assertions is worse than moderate coverage with strong assertions. Focus on testing behavior, not lines.
