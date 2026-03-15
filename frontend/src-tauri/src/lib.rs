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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[test]
    fn test_scan_image_files_finds_images() {
        let dir = TempDir::new().unwrap();

        // Create test image files
        fs::write(dir.path().join("photo.png"), b"fake png").unwrap();
        fs::write(dir.path().join("photo.jpg"), b"fake jpg").unwrap();
        fs::write(dir.path().join("photo.jpeg"), b"fake jpeg").unwrap();
        fs::write(dir.path().join("photo.webp"), b"fake webp").unwrap();
        fs::write(dir.path().join("photo.heic"), b"fake heic").unwrap();

        let result = scan_image_files(dir.path()).unwrap();
        assert_eq!(result.len(), 5, "Should find all 5 image files");
    }

    #[test]
    fn test_scan_image_files_ignores_non_images() {
        let dir = TempDir::new().unwrap();

        fs::write(dir.path().join("document.pdf"), b"fake pdf").unwrap();
        fs::write(dir.path().join("readme.txt"), b"text").unwrap();
        fs::write(dir.path().join("data.json"), b"{}").unwrap();
        fs::write(dir.path().join("photo.png"), b"fake png").unwrap();

        let result = scan_image_files(dir.path()).unwrap();
        assert_eq!(result.len(), 1, "Should only find the PNG");
        assert_eq!(result[0].name, "photo.png");
    }

    #[test]
    fn test_scan_image_files_empty_directory() {
        let dir = TempDir::new().unwrap();
        let result = scan_image_files(dir.path()).unwrap();
        assert!(result.is_empty(), "Empty directory should return no files");
    }

    #[test]
    fn test_scan_image_files_skips_directories() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();
        fs::write(dir.path().join("photo.png"), b"fake png").unwrap();

        let result = scan_image_files(dir.path()).unwrap();
        assert_eq!(result.len(), 1, "Should skip subdirectories");
    }

    #[test]
    fn test_scan_image_files_case_insensitive_extension() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("PHOTO.PNG"), b"fake").unwrap();
        fs::write(dir.path().join("Image.JPG"), b"fake").unwrap();

        let result = scan_image_files(dir.path()).unwrap();
        assert_eq!(result.len(), 2, "Should handle uppercase extensions");
    }

    #[test]
    fn test_selected_file_has_correct_fields() {
        let dir = TempDir::new().unwrap();
        let img_path = dir.path().join("test-screenshot.png");
        fs::write(&img_path, b"fake png").unwrap();

        let result = scan_image_files(dir.path()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "test-screenshot.png");
        assert!(result[0].path.ends_with("test-screenshot.png"));
    }

    #[test]
    fn test_scan_nonexistent_directory() {
        let result = scan_image_files(&PathBuf::from("/nonexistent/path"));
        assert!(result.is_err(), "Should return error for nonexistent directory");
    }
}
