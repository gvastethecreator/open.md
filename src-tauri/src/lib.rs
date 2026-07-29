use serde::Serialize;
use std::env;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, State};

mod document_access;
mod images;

#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);
#[cfg(target_os = "macos")]
static OPEN_FILE_REQUEST_COUNTER: AtomicUsize = AtomicUsize::new(1);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileRequest {
    id: usize,
    paths: Vec<String>,
}

#[derive(Default)]
struct PendingOpenFileRequests(Mutex<Vec<OpenFileRequest>>);

#[tauri::command]
fn get_file_content(path: String) -> Result<document_access::DocumentPayload, String> {
    document_access::open_document(Path::new(&path))
}

#[tauri::command]
fn get_initial_file_path(window: tauri::Window) -> Option<String> {
    if window.label() != "main" {
        return None;
    }

    initial_file_path(&env::args().collect::<Vec<_>>())
}

#[tauri::command]
fn take_pending_open_file_requests(
    state: State<'_, PendingOpenFileRequests>,
) -> Vec<OpenFileRequest> {
    state
        .0
        .lock()
        .map(|mut requests| std::mem::take(&mut *requests))
        .unwrap_or_default()
}

#[tauri::command]
fn acknowledge_open_file_request(id: usize, state: State<'_, PendingOpenFileRequests>) {
    if let Ok(mut requests) = state.0.lock() {
        requests.retain(|request| request.id != id);
    }
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

#[cfg(target_os = "macos")]
fn queue_open_file_request(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    let request = OpenFileRequest {
        id: OPEN_FILE_REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst),
        paths,
    };
    let state = app.state::<PendingOpenFileRequests>();
    if let Ok(mut requests) = state.0.lock() {
        requests.push(request.clone());
    }
    let _ = app.emit("open-file-request", request);
}

fn initial_file_path(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|argument| !argument.is_empty() && !argument.starts_with("--"))
        .cloned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for file_path in args.iter().skip(1).filter(|argument| {
                !argument.starts_with("--")
                    && document_access::is_supported_document(Path::new(argument))
            }) {
                let _ = build_document_window(app, file_path);
            }
        }))
        .manage(PendingOpenFileRequests::default())
        .invoke_handler(tauri::generate_handler![
            get_file_content,
            get_initial_file_path,
            images::get_image_bytes,
            open_new_window,
            take_pending_open_file_requests,
            acknowledge_open_file_request
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| document_access::is_supported_document(path))
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            queue_open_file_request(app_handle, paths);
        }

        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}

#[cfg(test)]
mod tests {
    use super::{initial_file_path, OpenFileRequest};

    #[test]
    fn open_file_request_serializes_the_frontend_contract() {
        let request = OpenFileRequest {
            id: 7,
            paths: vec!["/tmp/guide.md".to_string()],
        };
        let serialized = serde_json::to_value(request).expect("request should serialize");

        assert_eq!(serialized["id"], 7);
        assert_eq!(serialized["paths"][0], "/tmp/guide.md");
    }

    #[test]
    fn finds_the_first_non_flag_command_line_file() {
        let args = vec![
            "open-md".to_string(),
            "--tauri-flag".to_string(),
            "C:\\notes\\sample.md".to_string(),
        ];

        assert_eq!(
            initial_file_path(&args),
            Some("C:\\notes\\sample.md".to_string())
        );
        assert_eq!(initial_file_path(&["open-md".to_string()]), None);
    }
}
