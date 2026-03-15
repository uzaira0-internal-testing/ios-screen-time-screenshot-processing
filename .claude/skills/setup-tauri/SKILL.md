---
name: setup-tauri
description: |
  Add Tauri v2 to an existing React frontend project with plugins, capabilities, CSP, and build configuration.
  Use when the user asks to "add Tauri", "set up desktop app", "wrap my app in Tauri", or "create a native desktop wrapper".
user_invocable: true
---

# Setup Tauri v2

This skill adds Tauri v2 to an existing React frontend project, configuring plugins, capabilities, content security policy, and build scripts.

References: Chapters 04 and 05 of the Tauri integration guide.

## Step 1: Prerequisites Check

Before proceeding, verify:

1. **Rust toolchain** is installed (`rustc --version`, `cargo --version`)
2. **System dependencies** are present:
   - Linux: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
   - macOS: Xcode Command Line Tools
   - Windows: Visual Studio Build Tools, WebView2
3. **Node.js/Bun** is available for the frontend build
4. **The frontend project builds successfully** (`bun run build` or `npm run build`)

If any prerequisite is missing, inform the user and stop.

## Step 2: Initialize Tauri

Run the Tauri CLI init command from the frontend directory:

```bash
cd frontend && npx @tauri-apps/cli@latest init
```

When prompted (or configure manually afterward):
- **App name**: Ask the user
- **Window title**: Ask the user
- **Frontend dev URL**: `http://localhost:5175` (or whatever the dev server uses)
- **Frontend dev command**: `bun run dev` or `npm run dev`
- **Frontend build command**: `bun run build` or `npm run build`
- **Frontend dist directory**: `../dist` (relative to `src-tauri/`)

## Step 3: Configure tauri.conf.json

Generate or update `frontend/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/nicandris/tauri-v2-schema/main/tauri-v2.schema.json",
  "productName": "{{APP_NAME}}",
  "version": "0.1.0",
  "identifier": "com.{{org}}.{{app-name}}",
  "build": {
    "beforeBuildCommand": "bun run build",
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:5175",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "title": "{{WINDOW_TITLE}}",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: http://asset.localhost blob: data:; connect-src 'self' ipc: http://ipc.localhost https://api.github.com; font-src 'self' data:"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "wix": {
        "language": "en-US"
      }
    },
    "macOS": {
      "minimumSystemVersion": "10.15"
    }
  }
}
```

Ask the user for `APP_NAME`, `WINDOW_TITLE`, `org`, and `app-name` identifier values.

## Step 4: Configure Cargo.toml

Generate or update `frontend/src-tauri/Cargo.toml`:

```toml
[package]
name = "{{app-name}}"
version = "0.1.0"
description = "{{APP_DESCRIPTION}}"
authors = ["{{AUTHOR}}"]
edition = "2021"
rust-version = "1.77"

[lib]
name = "{{app_name_underscore}}_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### Recommended Plugins

Ask the user which plugins they want. Present this list:

| Plugin | Crate | Description |
|--------|-------|-------------|
| **opener** | `tauri-plugin-opener` | Open URLs and files with default app (included by default) |
| **dialog** | `tauri-plugin-dialog` | Native file open/save dialogs |
| **fs** | `tauri-plugin-fs` | Read/write filesystem access |
| **store** | `tauri-plugin-store` | Persistent key-value store (like localStorage but native) |
| **clipboard** | `tauri-plugin-clipboard-manager` | System clipboard read/write |
| **notification** | `tauri-plugin-notification` | Native OS notifications |
| **updater** | `tauri-plugin-updater` | Auto-update support (see setup-auto-updates skill) |
| **process** | `tauri-plugin-process` | Restart and exit control |
| **os** | `tauri-plugin-os` | OS information (platform, version, arch) |
| **http** | `tauri-plugin-http` | HTTP client that bypasses CORS |
| **shell** | `tauri-plugin-shell` | Execute system commands |
| **window-state** | `tauri-plugin-window-state` | Remember window size/position across sessions |
| **log** | `tauri-plugin-log` | Structured logging to file and console |
| **sql** | `tauri-plugin-sql` | SQLite/MySQL/PostgreSQL from frontend |
| **upload** | `tauri-plugin-upload` | File upload/download with progress |
| **deep-link** | `tauri-plugin-deep-link` | Handle custom URL schemes |
| **autostart** | `tauri-plugin-autostart` | Launch app on OS boot |
| **single-instance** | `tauri-plugin-single-instance` | Prevent multiple app instances |
| **global-shortcut** | `tauri-plugin-global-shortcut` | System-wide keyboard shortcuts |

For each selected plugin, add it to `Cargo.toml` dependencies and `lib.rs` initialization.

## Step 5: Generate lib.rs

Generate `frontend/src-tauri/src/lib.rs`:

```rust
// src-tauri/src/lib.rs

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Plugins - add selected plugins here
        .plugin(tauri_plugin_opener::init())
        // .plugin(tauri_plugin_dialog::init())
        // .plugin(tauri_plugin_fs::init())
        // .plugin(tauri_plugin_store::init())
        // .plugin(tauri_plugin_clipboard_manager::init())
        // .plugin(tauri_plugin_notification::init())
        // .plugin(tauri_plugin_process::init())
        // .plugin(tauri_plugin_os::init())
        // .plugin(tauri_plugin_window_state::init())
        // .plugin(tauri_plugin_log::Builder::new().build())
        // .plugin(tauri_plugin_updater::Builder::new().build())
        // .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        //     // Focus existing window when second instance launched
        //     if let Some(window) = app.get_webview_window("main") {
        //         let _ = window.set_focus();
        //     }
        // }))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Uncomment the lines for whichever plugins the user selected.

## Step 6: Generate main.rs

```rust
// src-tauri/src/main.rs

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    {{app_name_underscore}}_lib::run();
}
```

## Step 7: Generate build.rs

```rust
// src-tauri/build.rs

fn main() {
    tauri_build::build()
}
```

## Step 8: Configure Capabilities

Generate `frontend/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability granting core permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default"
  ]
}
```

For each plugin the user selected, add the corresponding permission. Common mappings:

| Plugin | Permission |
|--------|-----------|
| opener | `"opener:default"` |
| dialog | `"dialog:default"` |
| fs | `"fs:default"`, or scoped: `{ "identifier": "fs:allow-read-text-file", "allow": [{ "path": "$APPDATA/**" }] }` |
| store | `"store:default"` |
| clipboard | `"clipboard-manager:allow-read"`, `"clipboard-manager:allow-write"` |
| notification | `"notification:default"` |
| updater | `"updater:default"` |
| process | `"process:default"` |
| os | `"os:default"` |
| http | `{ "identifier": "http:default", "allow": [{ "url": "https://**" }] }` |
| shell | `"shell:default"` |
| window-state | `"window-state:default"` |
| log | `"log:default"` |
| global-shortcut | `"global-shortcut:default"` |
| single-instance | (no permission needed -- Rust-side only) |
| autostart | `"autostart:default"` |
| deep-link | `"deep-link:default"` |

## Step 9: CSP Configuration

The Content Security Policy in `tauri.conf.json` controls what resources the webview can load. The template in Step 3 covers common cases. Adjust based on the user's needs:

**If the app connects to external APIs:**
```
connect-src 'self' ipc: http://ipc.localhost https://your-api.example.com
```

**If the app loads external images:**
```
img-src 'self' asset: http://asset.localhost blob: data: https://images.example.com
```

**If the app uses web fonts from CDN:**
```
font-src 'self' data: https://fonts.gstatic.com
```

**If the app uses inline scripts (avoid if possible):**
```
script-src 'self' 'unsafe-inline'
```

## Step 10: Add Build Scripts to package.json

Add or update these scripts in `frontend/package.json`:

```json
{
  "scripts": {
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "tauri:build:debug": "tauri build --debug",
    "tauri:icon": "tauri icon ./src/assets/app-icon.png"
  }
}
```

## Step 11: Generate App Icons

If the user has a source icon (PNG, at least 1024x1024):

```bash
cd frontend && npx @tauri-apps/cli icon ./path-to-icon.png
```

This generates all required icon sizes in `src-tauri/icons/`.

If no icon is available, inform the user they can run this command later with their own icon.

## Step 12: Add .gitignore Entries

Append to `frontend/src-tauri/.gitignore` (create if needed):

```
/target/
/gen/
WixTools/
```

## Step 13: Verify Setup

Run the following to verify everything compiles:

```bash
cd frontend && npx @tauri-apps/cli dev
```

If there are compilation errors, diagnose and fix them before finishing. Common issues:
- Missing system dependencies (suggest install commands)
- Rust edition mismatch (ensure `edition = "2021"`)
- Plugin version conflicts (ensure all `tauri-plugin-*` versions are compatible with the `tauri` version)

## Final Checklist

- [ ] `src-tauri/tauri.conf.json` has correct app name, identifier, and dev/build commands
- [ ] `src-tauri/Cargo.toml` lists all selected plugin dependencies
- [ ] `src-tauri/src/lib.rs` initializes all selected plugins
- [ ] `src-tauri/capabilities/default.json` grants permissions for all selected plugins
- [ ] CSP in `tauri.conf.json` allows all required resource origins
- [ ] `package.json` has tauri build scripts
- [ ] `tauri dev` launches successfully
