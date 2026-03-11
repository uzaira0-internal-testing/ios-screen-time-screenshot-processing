use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_log::{Target, TargetKind};

#[derive(Clone, serde::Serialize)]
struct SingleInstancePayload {
    args: Vec<String>,
    cwd: String,
}

#[derive(Serialize)]
pub struct SelectedFile {
    pub name: String,
    pub path: String,
}

/// Opens a native folder picker and returns metadata for image files found.
/// File bytes are NOT loaded here — the frontend reads them lazily via tauri-plugin-fs.
#[tauri::command]
async fn select_screenshot_folder(app: tauri::AppHandle) -> Result<Vec<SelectedFile>, String> {
    let folder = app
        .dialog()
        .file()
        .set_title("Select Screenshot Folder")
        .blocking_pick_folder();

    let folder = match folder {
        Some(f) => f.into_path().map_err(|e| e.to_string())?,
        None => return Ok(vec![]),
    };

    scan_image_files(&folder)
}

fn scan_image_files(dir: &Path) -> Result<Vec<SelectedFile>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;

    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "heic" | "webp") {
            continue;
        }

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let path_str = path.to_string_lossy().to_string();

        files.push(SelectedFile {
            name,
            path: path_str,
        });
    }

    Ok(files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            println!("{}, {argv:?}, {cwd}", app.package_info().name);
            let _ = app.emit("single-instance", SingleInstancePayload { args: argv, cwd });
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![select_screenshot_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
