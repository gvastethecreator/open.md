use std::env;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::AppHandle;

mod app_settings;
mod cp437;
mod document_access;
mod file_associations;
mod images;
mod open_requests;

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);
/// Boot-time mode: true when this process skipped the single-instance plugin.
static PROCESS_ALLOWS_MULTIPLE_INSTANCES: AtomicBool = AtomicBool::new(true);

#[tauri::command]
fn get_file_content(path: String) -> Result<document_access::DocumentPayload, String> {
    document_access::open_document(Path::new(&path))
}

#[tauri::command]
fn save_file_content(
    path: String,
    content: String,
) -> Result<document_access::DocumentPayload, String> {
    document_access::save_document(Path::new(&path), &content)
}

#[tauri::command]
fn save_file_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    document_access::save_bytes(Path::new(&path), &contents)
}

#[tauri::command]
fn get_initial_file_paths(window: tauri::Window) -> Vec<String> {
    if window.label() != "main" {
        return Vec::new();
    }

    initial_file_paths(&env::args().collect::<Vec<_>>())
}

fn build_document_window(app: &AppHandle, path: &str) -> Result<(), String> {
    let counter = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("window-{counter}");
    let url = format!("index.html?file={}", urlencoding::encode(path));

    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
        .title("open.md")
        .decorations(false)
        .inner_size(900.0, 700.0)
        .min_inner_size(440.0, 320.0)
        .center()
        .build()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn open_new_window(app: AppHandle, path: String) -> Result<(), String> {
    build_document_window(&app, &path)
}

#[tauri::command]
fn get_process_instance_mode() -> serde_json::Value {
    let disk = app_settings::load();
    let process_allows = PROCESS_ALLOWS_MULTIPLE_INSTANCES.load(Ordering::SeqCst);
    serde_json::json!({
        "allowMultipleInstances": disk.allow_multiple_instances,
        "processAllowsMultipleInstances": process_allows,
        "restartRequired": disk.allow_multiple_instances != process_allows,
    })
}

#[tauri::command]
fn set_allow_multiple_instances(
    value: bool,
) -> Result<app_settings::SetAllowMultipleInstancesResult, String> {
    app_settings::set_allow_multiple_instances(value)
}

#[tauri::command]
fn get_file_association_status() -> file_associations::FileAssociationStatus {
    file_associations::get_status()
}

#[tauri::command]
fn request_file_association() -> Result<file_associations::FileAssociationActionResult, String> {
    file_associations::request_association()
}

fn initial_file_paths(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|argument| !argument.is_empty() && !argument.starts_with("--"))
        .cloned()
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let boot_settings = app_settings::load();
    PROCESS_ALLOWS_MULTIPLE_INSTANCES
        .store(boot_settings.allow_multiple_instances, Ordering::SeqCst);

    // Single-instance must register first when enabled (plugin contract).
    let mut builder = tauri::Builder::default();
    if !boot_settings.allow_multiple_instances {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = args
                .into_iter()
                .skip(1)
                .filter(|argument| !argument.is_empty() && !argument.starts_with("--"))
                .collect();
            open_requests::deliver(app, paths);
        }));
    }
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    let app = builder
        .manage(open_requests::OpenRequestQueue::default())
        .invoke_handler(tauri::generate_handler![
            get_file_content,
            save_file_content,
            save_file_bytes,
            get_initial_file_paths,
            images::get_image_bytes,
            images::get_standalone_image_bytes,
            open_new_window,
            open_requests::list_pending_open_file_requests,
            open_requests::acknowledge_open_file_request,
            get_process_instance_mode,
            set_allow_multiple_instances,
            get_file_association_status,
            request_file_association
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } = &event
        {
            open_requests::redeliver_pending(app_handle, label);
        }

        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            open_requests::deliver(app_handle, paths);
        }

        #[cfg(not(target_os = "macos"))]
        let _ = event;
    });
}

#[cfg(test)]
mod tests {
    use super::initial_file_paths;

    #[test]
    fn preserves_non_flag_command_line_paths_for_frontend_policy() {
        let args = vec![
            "open-md".to_string(),
            "--tauri-flag".to_string(),
            "C:\\notes\\sample.md".to_string(),
            "C:\\notes\\photo.png".to_string(),
        ];

        assert_eq!(
            initial_file_paths(&args),
            vec![
                "C:\\notes\\sample.md".to_string(),
                "C:\\notes\\photo.png".to_string(),
            ]
        );
        assert!(initial_file_paths(&["open-md".to_string()]).is_empty());
    }
}
