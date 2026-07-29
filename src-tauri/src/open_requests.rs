use serde::Serialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenFileRequest {
    pub(crate) id: usize,
    paths: Vec<String>,
}

pub(crate) struct OpenRequestQueue {
    next_id: AtomicUsize,
    pending: Mutex<Vec<OpenFileRequest>>,
}

impl Default for OpenRequestQueue {
    fn default() -> Self {
        Self {
            next_id: AtomicUsize::new(1),
            pending: Mutex::new(Vec::new()),
        }
    }
}

impl OpenRequestQueue {
    fn enqueue(&self, paths: Vec<String>) -> Option<OpenFileRequest> {
        if paths.is_empty() {
            return None;
        }

        let request = OpenFileRequest {
            id: self.next_id.fetch_add(1, Ordering::SeqCst),
            paths,
        };
        self.pending.lock().ok()?.push(request.clone());
        Some(request)
    }

    fn list(&self) -> Vec<OpenFileRequest> {
        self.pending
            .lock()
            .map(|requests| requests.clone())
            .unwrap_or_default()
    }

    fn acknowledge(&self, id: usize) -> bool {
        self.pending
            .lock()
            .map(|mut requests| {
                let previous_len = requests.len();
                requests.retain(|request| request.id != id);
                previous_len != requests.len()
            })
            .unwrap_or(false)
    }
}

fn order_coordinator_labels<I, S>(labels: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut labels: Vec<String> = labels
        .into_iter()
        .map(|label| label.as_ref().to_string())
        .collect();
    labels.sort_unstable();
    if let Some(main_index) = labels.iter().position(|label| label == "main") {
        let main = labels.remove(main_index);
        labels.insert(0, main);
    }
    labels
}

fn select_coordinator_label<I, S>(labels: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    order_coordinator_labels(labels).into_iter().next()
}

fn coordinator_labels(app: &AppHandle, excluded_label: Option<&str>) -> Vec<String> {
    let windows = app.webview_windows();
    order_coordinator_labels(
        windows
            .keys()
            .filter(|label| excluded_label != Some(label.as_str())),
    )
}

fn coordinator_label(app: &AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    select_coordinator_label(windows.keys())
}

fn emit_request(app: &AppHandle, request: &OpenFileRequest, excluded_label: Option<&str>) {
    for label in coordinator_labels(app, excluded_label) {
        if app
            .emit_to(label, "open-file-request", request.clone())
            .is_ok()
        {
            break;
        }
    }
}

pub(crate) fn deliver(app: &AppHandle, paths: Vec<String>) {
    let queue = app.state::<OpenRequestQueue>();
    if let Some(request) = queue.enqueue(paths) {
        emit_request(app, &request, None);
    }
}

pub(crate) fn redeliver_pending(app: &AppHandle, departed_label: &str) {
    let queue = app.state::<OpenRequestQueue>();
    for request in queue.list() {
        emit_request(app, &request, Some(departed_label));
    }
}

#[tauri::command]
pub(crate) fn list_pending_open_file_requests(
    window: tauri::Window,
    queue: State<'_, OpenRequestQueue>,
) -> Vec<OpenFileRequest> {
    if coordinator_label(window.app_handle()).as_deref() == Some(window.label()) {
        queue.list()
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub(crate) fn acknowledge_open_file_request(id: usize, queue: State<'_, OpenRequestQueue>) -> bool {
    queue.acknowledge(id)
}

#[cfg(test)]
mod tests {
    use super::{select_coordinator_label, OpenRequestQueue};

    #[test]
    fn main_window_is_preferred_but_a_reader_window_can_coordinate() {
        assert_eq!(
            select_coordinator_label(["window-2", "main", "window-1"]),
            Some("main".to_string())
        );
        assert_eq!(
            select_coordinator_label(["window-2", "window-1"]),
            Some("window-1".to_string())
        );
        assert_eq!(select_coordinator_label(std::iter::empty::<&str>()), None);
    }

    #[test]
    fn pending_requests_are_listed_non_destructively_until_acknowledged() {
        let queue = OpenRequestQueue::default();
        let request = queue
            .enqueue(vec!["one.md".to_string(), "two.txt".to_string()])
            .expect("non-empty request should queue");

        assert_eq!(queue.list(), vec![request.clone()]);
        assert_eq!(queue.list(), vec![request.clone()]);
        assert!(queue.acknowledge(request.id));
        assert!(queue.list().is_empty());
        assert!(!queue.acknowledge(request.id));
    }

    #[test]
    fn request_ids_are_stable_unique_and_serialize_for_the_frontend() {
        let queue = OpenRequestQueue::default();
        assert!(queue.enqueue(Vec::new()).is_none());
        let first = queue
            .enqueue(vec!["one.md".to_string()])
            .expect("first request should queue");
        let second = queue
            .enqueue(vec!["two.md".to_string()])
            .expect("second request should queue");

        assert!(second.id > first.id);
        let serialized = serde_json::to_value(first).expect("request should serialize");
        assert!(serialized["id"].as_u64().unwrap_or_default() > 0);
        assert_eq!(serialized["paths"][0], "one.md");
    }
}
