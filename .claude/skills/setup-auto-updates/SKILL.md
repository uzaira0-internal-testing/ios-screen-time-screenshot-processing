---
name: setup-auto-updates
description: |
  Set up Tauri v2 auto-updates with code signing, a GitHub Actions CI/CD pipeline, and an in-app UpdateBanner component.
  Use when the user asks to "add auto-updates", "set up Tauri updater", "create update workflow", or "ship desktop updates via GitHub".
user_invocable: true
---

# Setup Tauri Auto-Updates

This skill configures Tauri v2 auto-update support end-to-end: signing keys, GitHub Actions CI/CD for multi-platform builds, update manifest generation, and a React UpdateBanner component.

References: Chapter 05 of the auto-update guide.

## Step 1: Prerequisites Check

Before proceeding, verify:

1. **Tauri v2 is already configured** in the project (if not, run the `setup-tauri` skill first)
2. **The project is hosted on GitHub** (needed for releases and Actions)
3. **The user has admin access** to the GitHub repository (needed to add secrets)

## Step 2: Generate Signing Keys

Tauri requires an Ed25519 key pair to sign updates. Run:

```bash
cd frontend && npx @tauri-apps/cli signer generate -w ~/.tauri/myapp.key
```

This produces:
- **Private key**: `~/.tauri/myapp.key` (NEVER commit this)
- **Public key**: printed to stdout (safe to embed in config)
- **Password**: user-chosen (needed at build time)

Instruct the user:
1. Copy the **public key** -- it goes into `tauri.conf.json`
2. Store the **private key content** and **password** as GitHub repository secrets:
   - `TAURI_SIGNING_PRIVATE_KEY` = contents of `~/.tauri/myapp.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password they chose

## Step 3: Configure tauri.conf.json for Updates

Add or merge the updater configuration into `frontend/src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "{{PUBLIC_KEY_FROM_STEP_2}}",
      "endpoints": [
        "https://github.com/{{OWNER}}/{{REPO}}/releases/latest/download/latest.json"
      ],
      "dialog": false
    }
  },
  "bundle": {
    "createUpdaterArtifacts": "v2Compatible"
  }
}
```

Ask the user for the GitHub `OWNER` and `REPO` values.

## Step 4: Add Updater Plugin to Cargo.toml

Ensure these are in `frontend/src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

## Step 5: Register Plugins in lib.rs

Ensure `lib.rs` includes:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

## Step 6: Add Capabilities

Ensure `frontend/src-tauri/capabilities/default.json` includes:

```json
{
  "permissions": [
    "updater:default",
    "process:default"
  ]
}
```

## Step 7: Install Frontend Dependencies

```bash
cd frontend && bun add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

Or with npm:

```bash
cd frontend && npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

## Step 8: Create updater.ts

Generate `frontend/src/lib/updater.ts`:

```typescript
// src/lib/updater.ts

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateStatus {
  available: boolean;
  currentVersion: string;
  newVersion?: string;
  date?: string;
  body?: string;
}

export interface UpdateProgress {
  /** Download progress as a number between 0 and 1 */
  progress: number;
  /** Total bytes to download */
  total: number;
  /** Bytes downloaded so far */
  downloaded: number;
}

/**
 * Check for available updates.
 * Returns null if running in browser (non-Tauri) context.
 */
export async function checkForUpdate(): Promise<UpdateStatus | null> {
  // Guard: only run in Tauri context
  if (!("__TAURI_INTERNALS__" in window)) {
    return null;
  }

  try {
    const update = await check();

    if (!update) {
      return {
        available: false,
        currentVersion: getCurrentVersion(),
      };
    }

    return {
      available: true,
      currentVersion: getCurrentVersion(),
      newVersion: update.version,
      date: update.date ?? undefined,
      body: update.body ?? undefined,
    };
  } catch (error) {
    console.error("Failed to check for updates:", error);
    return null;
  }
}

/**
 * Download and install an available update.
 * Calls onProgress during download, then relaunches the app.
 */
export async function downloadAndInstall(
  onProgress?: (progress: UpdateProgress) => void
): Promise<void> {
  const update = await check();

  if (!update) {
    throw new Error("No update available");
  }

  let downloaded = 0;
  let contentLength = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({
          progress: contentLength > 0 ? downloaded / contentLength : 0,
          total: contentLength,
          downloaded,
        });
        break;
      case "Finished":
        onProgress?.({
          progress: 1,
          total: contentLength,
          downloaded: contentLength,
        });
        break;
    }
  });

  // Relaunch the app to apply the update
  await relaunch();
}

function getCurrentVersion(): string {
  // This is replaced at build time by Tauri
  return "__APP_VERSION__";
}
```

## Step 9: Create UpdateBanner.tsx

Generate `frontend/src/components/UpdateBanner.tsx`:

```typescript
// src/components/UpdateBanner.tsx

import { useCallback, useEffect, useState } from "react";
import {
  checkForUpdate,
  downloadAndInstall,
  type UpdateProgress,
  type UpdateStatus,
} from "../lib/updater";

interface UpdateBannerProps {
  /** How often to check for updates, in milliseconds. Default: 30 minutes. */
  checkInterval?: number;
  /** Custom class name for the banner container */
  className?: string;
}

type BannerState =
  | { kind: "hidden" }
  | { kind: "available"; status: UpdateStatus }
  | { kind: "downloading"; progress: UpdateProgress }
  | { kind: "error"; message: string };

export function UpdateBanner({
  checkInterval = 30 * 60 * 1000,
  className,
}: UpdateBannerProps) {
  const [state, setState] = useState<BannerState>({ kind: "hidden" });

  // Check for updates on mount and on interval
  useEffect(() => {
    let cancelled = false;

    async function doCheck() {
      const status = await checkForUpdate();
      if (cancelled) return;

      if (status?.available) {
        setState({ kind: "available", status });
      }
    }

    doCheck();

    const timer = setInterval(doCheck, checkInterval);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [checkInterval]);

  const handleUpdate = useCallback(async () => {
    try {
      setState({
        kind: "downloading",
        progress: { progress: 0, total: 0, downloaded: 0 },
      });

      await downloadAndInstall((progress) => {
        setState({ kind: "downloading", progress });
      });

      // App will relaunch after install -- this line may not execute
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Update failed",
      });
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setState({ kind: "hidden" });
  }, []);

  if (state.kind === "hidden") {
    return null;
  }

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "1rem",
        right: "1rem",
        zIndex: 9999,
        padding: "1rem 1.5rem",
        borderRadius: "0.5rem",
        backgroundColor: state.kind === "error" ? "#fef2f2" : "#eff6ff",
        border: `1px solid ${state.kind === "error" ? "#fecaca" : "#bfdbfe"}`,
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        maxWidth: "400px",
        fontFamily: "system-ui, sans-serif",
        fontSize: "0.875rem",
      }}
    >
      {state.kind === "available" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            Update Available
          </div>
          <div style={{ marginBottom: "0.75rem", color: "#374151" }}>
            Version {state.status.newVersion} is ready to install.
            {state.status.body && (
              <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "#6b7280" }}>
                {state.status.body}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleUpdate}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 500,
              }}
            >
              Update Now
            </button>
            <button
              onClick={handleDismiss}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor: "transparent",
                color: "#6b7280",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontSize: "0.8rem",
              }}
            >
              Later
            </button>
          </div>
        </>
      )}

      {state.kind === "downloading" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            Downloading Update...
          </div>
          <div
            style={{
              width: "100%",
              height: "6px",
              backgroundColor: "#dbeafe",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(state.progress.progress * 100)}%`,
                height: "100%",
                backgroundColor: "#2563eb",
                borderRadius: "3px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ marginTop: "0.25rem", color: "#6b7280", fontSize: "0.75rem" }}>
            {Math.round(state.progress.progress * 100)}%
            {state.progress.total > 0 &&
              ` (${formatBytes(state.progress.downloaded)} / ${formatBytes(state.progress.total)})`}
          </div>
        </>
      )}

      {state.kind === "error" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#dc2626" }}>
            Update Failed
          </div>
          <div style={{ marginBottom: "0.75rem", color: "#7f1d1d" }}>
            {state.message}
          </div>
          <button
            onClick={handleDismiss}
            style={{
              padding: "0.375rem 0.75rem",
              backgroundColor: "transparent",
              color: "#6b7280",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
```

## Step 10: Create GitHub Actions Workflow

Generate `.github/workflows/tauri-release.yml`:

```yaml
name: Tauri Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
    inputs:
      version:
        description: "Version tag (e.g., v1.0.0)"
        required: true

permissions:
  contents: write

jobs:
  create-release:
    runs-on: ubuntu-latest
    outputs:
      release_id: ${{ steps.create.outputs.id }}
      version: ${{ steps.version.outputs.version }}
    steps:
      - name: Determine version
        id: version
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "version=${{ github.event.inputs.version }}" >> $GITHUB_OUTPUT
          else
            echo "version=${GITHUB_REF#refs/tags/}" >> $GITHUB_OUTPUT
          fi

      - name: Create GitHub Release
        id: create
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ steps.version.outputs.version }}
          release_name: Release ${{ steps.version.outputs.version }}
          draft: true
          prerelease: false

  build:
    needs: create-release
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
            target: x86_64-unknown-linux-gnu
          - platform: macos-latest
            target: aarch64-apple-darwin
          - platform: macos-latest
            target: x86_64-apple-darwin
          - platform: windows-latest
            target: x86_64-pc-windows-msvc

    runs-on: ${{ matrix.platform }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: frontend/src-tauri -> target

      - name: Install Linux dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            build-essential \
            curl \
            wget \
            file \
            libxdo-dev \
            libssl-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Install frontend dependencies
        working-directory: frontend
        run: bun install

      - name: Build and release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: frontend
          releaseId: ${{ needs.create-release.outputs.release_id }}
          args: --target ${{ matrix.target }}

  publish-release:
    needs: [create-release, build]
    runs-on: ubuntu-latest
    steps:
      - name: Publish release
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.repos.updateRelease({
              owner: context.repo.owner,
              repo: context.repo.repo,
              release_id: ${{ needs.create-release.outputs.release_id }},
              draft: false,
            });

  generate-latest-json:
    needs: [create-release, build, publish-release]
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Generate latest.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VERSION: ${{ needs.create-release.outputs.version }}
        run: |
          RELEASE_DATA=$(gh release view "$VERSION" --json assets,body,publishedAt)
          PUBLISHED_AT=$(echo "$RELEASE_DATA" | jq -r '.publishedAt')
          NOTES=$(echo "$RELEASE_DATA" | jq -r '.body // ""')

          # Build platform entries from release assets
          PLATFORMS='{}'

          # Helper to add platform if asset exists
          add_platform() {
            local key=$1 sig_suffix=$2 url_suffix=$3
            local sig_asset url_asset
            sig_asset=$(echo "$RELEASE_DATA" | jq -r ".assets[].name | select(endswith(\"$sig_suffix\"))" | head -1)
            url_asset=$(echo "$RELEASE_DATA" | jq -r ".assets[].name | select(endswith(\"$url_suffix\"))" | head -1)

            if [ -n "$sig_asset" ] && [ -n "$url_asset" ]; then
              local sig_content
              sig_content=$(gh release download "$VERSION" -p "$sig_asset" -O - 2>/dev/null || echo "")
              if [ -n "$sig_content" ]; then
                local download_url="https://github.com/${{ github.repository }}/releases/download/$VERSION/$url_asset"
                PLATFORMS=$(echo "$PLATFORMS" | jq --arg key "$key" --arg url "$download_url" --arg sig "$sig_content" \
                  '. + {($key): {"signature": $sig, "url": $url}}')
              fi
            fi
          }

          add_platform "linux-x86_64" ".AppImage.sig" ".AppImage"
          add_platform "darwin-aarch64" ".app.tar.gz.sig" ".app.tar.gz"
          add_platform "darwin-x86_64" ".app.tar.gz.sig" ".app.tar.gz"
          add_platform "windows-x86_64" ".msi.sig" ".msi"

          # Build final JSON
          jq -n \
            --arg version "${VERSION#v}" \
            --arg notes "$NOTES" \
            --arg pub_date "$PUBLISHED_AT" \
            --argjson platforms "$PLATFORMS" \
            '{version: $version, notes: $notes, pub_date: $pub_date, platforms: $platforms}' \
            > latest.json

          echo "Generated latest.json:"
          cat latest.json

          # Upload latest.json to the release
          gh release upload "$VERSION" latest.json --clobber

      - name: Verify latest.json
        env:
          VERSION: ${{ needs.create-release.outputs.version }}
        run: |
          echo "Verifying latest.json is accessible..."
          sleep 5
          curl -sL "https://github.com/${{ github.repository }}/releases/download/$VERSION/latest.json" | jq .
```

## Step 11: latest.json Format Reference

The auto-generated `latest.json` follows this structure (for troubleshooting):

```json
{
  "version": "1.0.0",
  "notes": "Release notes from GitHub release body",
  "pub_date": "2025-01-15T10:00:00Z",
  "platforms": {
    "linux-x86_64": {
      "signature": "base64-encoded-ed25519-signature",
      "url": "https://github.com/OWNER/REPO/releases/download/v1.0.0/app_1.0.0_amd64.AppImage"
    },
    "darwin-aarch64": {
      "signature": "base64-encoded-ed25519-signature",
      "url": "https://github.com/OWNER/REPO/releases/download/v1.0.0/app_1.0.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "base64-encoded-ed25519-signature",
      "url": "https://github.com/OWNER/REPO/releases/download/v1.0.0/app_1.0.0_x64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "base64-encoded-ed25519-signature",
      "url": "https://github.com/OWNER/REPO/releases/download/v1.0.0/app_1.0.0_x64-setup.msi"
    }
  }
}
```

## Step 12: Wire UpdateBanner Into the App

Instruct the user to add `<UpdateBanner />` near the root of their app:

```tsx
import { UpdateBanner } from "./components/UpdateBanner";

function App() {
  return (
    <>
      {/* existing app content */}
      <UpdateBanner checkInterval={30 * 60 * 1000} />
    </>
  );
}
```

## Troubleshooting

### Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| "Signature verification failed" | Public key in `tauri.conf.json` does not match the private key used to sign | Re-generate keys or ensure `TAURI_SIGNING_PRIVATE_KEY` matches the public key in config |
| "Failed to fetch update manifest" | `latest.json` URL is wrong or release is still a draft | Check the endpoint URL; ensure the `publish-release` job ran |
| Update check returns null in browser | Expected -- updater only works in Tauri context | The `checkForUpdate()` function guards against this |
| macOS build fails with signing errors | Missing Apple Developer certificate | For unsigned builds, remove `macOS.signing` from bundle config |
| "No update available" even after new release | Version in `tauri.conf.json` matches or is higher than release | Ensure `tauri.conf.json` version is lower than the released version |
| Windows Defender blocks update | Unsigned MSI installer | Consider purchasing a code signing certificate for production |
| `latest.json` is missing a platform | Build job for that platform failed silently | Check the Actions logs for the failing platform |

### Testing Updates Locally

1. Build a "current" version with a low version number (e.g., `0.0.1`) in `tauri.conf.json`
2. Create a `latest.json` pointing to a local or test server
3. Temporarily change the endpoint in `tauri.conf.json` to your test server
4. Run the app and verify the update banner appears

### Release Workflow

1. Update version in `frontend/src-tauri/tauri.conf.json`
2. Commit and push
3. Create and push a git tag: `git tag v1.0.0 && git push origin v1.0.0`
4. GitHub Actions builds all platforms, creates a draft release, attaches artifacts, generates `latest.json`, and publishes
5. Existing app installations detect the update within 30 minutes (or on next launch)
