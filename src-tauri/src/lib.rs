use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use std::env;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use syntect::highlighting::ThemeSet;
use syntect::html::highlighted_html_for_string;
use syntect::parsing::SyntaxSet;
use tauri::{AppHandle, State};
mod images;
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);
#[cfg(target_os = "macos")]
static OPEN_FILE_REQUEST_COUNTER: AtomicUsize = AtomicUsize::new(1);
static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
static THEME_SET: OnceLock<ThemeSet> = OnceLock::new();

const MAX_RENDERABLE_FILE_SIZE_BYTES: u64 = 20 * 1024 * 1024;
const READING_WORDS_PER_MINUTE: usize = 220;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPayload {
    html: String,
    source: String,
    line_count: usize,
    character_count: usize,
    word_count: usize,
    reading_time_minutes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileRequest {
    id: usize,
    paths: Vec<String>,
}

#[derive(Default)]
struct PendingOpenFileRequests(Mutex<Vec<OpenFileRequest>>);

#[tauri::command]
fn get_file_content(
    window: tauri::Window,
    path: Option<String>,
) -> Result<DocumentPayload, String> {
    // If a path was explicitly passed
    if let Some(file_path) = path {
        if !file_path.is_empty() {
            return process_file(&file_path);
        }
    }

    // Only use command line arguments for the main window
    if window.label() == "main" {
        let args: Vec<String> = env::args().collect();
        if let Some(file_path) = initial_file_path(&args) {
            return process_file(&file_path);
        }
    }

    get_welcome_content()
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
    let label = format!("window-{}", counter);
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

fn syntax_set() -> &'static SyntaxSet {
    SYNTAX_SET.get_or_init(SyntaxSet::load_defaults_newlines)
}

fn theme_set() -> &'static ThemeSet {
    THEME_SET.get_or_init(ThemeSet::load_defaults)
}

pub(crate) fn is_supported_extension(file_path: &Path) -> bool {
    file_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt"
            )
        })
        .unwrap_or(false)
}

fn initial_file_path(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|argument| !argument.is_empty() && !argument.starts_with("--"))
        .cloned()
}

pub(crate) fn file_size_label(bytes: u64) -> String {
    const MIB: f64 = 1024.0 * 1024.0;
    format!("{:.1} MiB", bytes as f64 / MIB)
}

pub(crate) fn user_friendly_read_error(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => {
            "The file does not exist or is no longer available.".to_string()
        }
        std::io::ErrorKind::PermissionDenied => {
            "You do not have permission to read this file.".to_string()
        }
        _ => format!("Could not read the file: {}", error),
    }
}

fn process_file(file_path: &str) -> Result<DocumentPayload, String> {
    let canonical_path = fs::canonicalize(file_path).map_err(user_friendly_read_error)?;

    if !is_supported_extension(&canonical_path) {
        return Err(
            "Unsupported file format. Open a .md, .markdown or .txt file instead.".to_string(),
        );
    }

    let metadata = fs::metadata(&canonical_path).map_err(user_friendly_read_error)?;
    if metadata.len() > MAX_RENDERABLE_FILE_SIZE_BYTES {
        return Err(format!(
            "The file is too large for an instant view ({}). Current limit: {}.",
            file_size_label(metadata.len()),
            file_size_label(MAX_RENDERABLE_FILE_SIZE_BYTES)
        ));
    }

    let bytes = fs::read(&canonical_path).map_err(user_friendly_read_error)?;
    let content = String::from_utf8(bytes)
        .map_err(|_| "The file is not in UTF-8 and cannot be rendered correctly.".to_string())?;

    match canonical_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("md") | Some("markdown") => Ok(build_document_payload(&content, true)),
        Some("txt") => Ok(build_document_payload(&content, false)),
        _ => {
            Err("Unsupported file format. Open a .md, .markdown or .txt file instead.".to_string())
        }
    }
}

fn get_welcome_content() -> Result<DocumentPayload, String> {
    let welcome = "# Welcome to open.md\n\nDrag a `.md` or `.txt` file here, or open the application with a file.";
    Ok(build_document_payload(welcome, true))
}

fn build_document_payload(content: &str, is_markdown: bool) -> DocumentPayload {
    let word_count = content.split_whitespace().count();
    let reading_time_minutes = if word_count == 0 {
        0
    } else {
        (word_count + READING_WORDS_PER_MINUTE - 1) / READING_WORDS_PER_MINUTE
    };

    let html = if is_markdown {
        render_markdown_with_highlighting(content)
    } else {
        format!(
            "<span class=\"source-line-anchor\" data-source-line=\"1\" aria-hidden=\"true\"></span><pre data-plain-text=\"true\"><code>{}</code></pre>",
            html_escape::encode_text(content)
        )
    };

    DocumentPayload {
        html,
        source: content.to_string(),
        line_count: content.bytes().filter(|byte| *byte == b'\n').count() + 1,
        character_count: content.chars().count(),
        word_count,
        reading_time_minutes,
    }
}

fn source_line_starts(content: &str) -> Vec<usize> {
    let mut starts = vec![0];
    starts.extend(
        content
            .bytes()
            .enumerate()
            .filter_map(|(index, byte)| (byte == b'\n').then_some(index + 1)),
    );
    starts
}

fn source_line_for_offset(line_starts: &[usize], offset: usize) -> usize {
    match line_starts.binary_search(&offset) {
        Ok(index) => index + 1,
        Err(index) => index.max(1),
    }
}

fn tag_has_source_line(tag: &Tag<'_>) -> bool {
    matches!(
        tag,
        Tag::Paragraph
            | Tag::Heading { .. }
            | Tag::BlockQuote(_)
            | Tag::CodeBlock(_)
            | Tag::List(_)
            | Tag::FootnoteDefinition(_)
            | Tag::Table(_)
            | Tag::DefinitionList
    )
}

fn render_markdown_with_highlighting(content: &str) -> String {
    let ps = syntax_set();
    let ts = theme_set();
    let theme = ts.themes.get("base16-ocean.dark").unwrap_or_else(|| {
        ts.themes
            .values()
            .next()
            .expect("theme set should not be empty")
    });

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let mut in_code_block = false;
    let mut code_block_lang = String::new();
    let mut code_block_content = String::new();
    let line_starts = source_line_starts(content);

    let parser = Parser::new_ext(content, options)
        .into_offset_iter()
        .flat_map(|(event, source_range)| {
            let mut output = Vec::with_capacity(2);

            if matches!(&event, Event::Start(tag) if tag_has_source_line(tag)) {
                let source_line = source_line_for_offset(&line_starts, source_range.start);
                output.push(Event::Html(
                    format!(
                        "<span class=\"source-line-anchor\" data-source-line=\"{source_line}\" aria-hidden=\"true\"></span>"
                    )
                    .into(),
                ));
            }

            match event {
                Event::Html(raw_html) | Event::InlineHtml(raw_html) => {
                    output.push(Event::Text(raw_html));
                }
                Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(ref lang))) => {
                    in_code_block = true;
                    code_block_lang = lang.to_string();
                    code_block_content.clear();
                }
                Event::Start(Tag::CodeBlock(CodeBlockKind::Indented)) => {
                    in_code_block = true;
                    code_block_lang = String::new();
                    code_block_content.clear();
                }
                Event::End(TagEnd::CodeBlock) => {
                    in_code_block = false;

                    if code_block_lang == "mermaid" {
                        let html = format!(
                            "<div class=\"mermaid\">{}</div>",
                            html_escape::encode_text(&code_block_content)
                        );
                        output.push(Event::Html(html.into()));
                    } else {
                        let syntax = if !code_block_lang.is_empty() {
                            ps.find_syntax_by_token(&code_block_lang)
                                .unwrap_or_else(|| ps.find_syntax_plain_text())
                        } else {
                            ps.find_syntax_plain_text()
                        };

                        let html = highlighted_html_for_string(
                            &code_block_content,
                            ps,
                            syntax,
                            theme,
                        )
                        .unwrap_or_else(|_| {
                            format!(
                                "<pre><code>{}</code></pre>",
                                html_escape::encode_text(&code_block_content)
                            )
                        });

                        output.push(Event::Html(html.into()));
                    }
                }
                Event::Text(ref text) if in_code_block => {
                    code_block_content.push_str(text);
                }
                _ => output.push(event),
            }

            output
        });

    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for file_path in args.iter().skip(1).filter(|argument| {
                !argument.starts_with("--") && is_supported_extension(Path::new(argument))
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
                .filter(|path| is_supported_extension(path))
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
    use super::{
        file_size_label, get_welcome_content, initial_file_path, is_supported_extension,
        render_markdown_with_highlighting,
    };
    use std::path::Path;

    #[test]
    fn renders_headings_and_paragraphs() {
        let html = render_markdown_with_highlighting("# Hello\n\nSimple text");

        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<p>Simple text</p>"));
        assert!(html.contains("data-source-line=\"1\""));
        assert!(html.contains("data-source-line=\"3\""));
    }

    #[test]
    fn renders_mermaid_blocks_with_wrapper() {
        let html = render_markdown_with_highlighting("```mermaid\ngraph TD\nA-->B\n```");

        assert!(html.contains("<div class=\"mermaid\">"));
        assert!(html.contains("graph TD"));
    }

    #[test]
    fn escapes_raw_html_from_untrusted_markdown() {
        let html = render_markdown_with_highlighting(
            "<style>body { display: none; }</style>\n\nHello <img src=x onerror=alert(1)>",
        );

        assert!(!html.contains("<style>"));
        assert!(!html.contains("<img src=x"));
        assert!(html.contains("&lt;style&gt;"));
        assert!(html.contains("&lt;img src=x onerror=alert(1)&gt;"));
    }

    #[test]
    fn welcome_content_mentions_supported_files() {
        let payload = get_welcome_content().expect("welcome content should render");

        assert!(payload.html.contains("open.md"));
        assert!(payload.html.contains(".md"));
        assert!(payload.html.contains(".txt"));
        assert_eq!(payload.line_count, 3);
        assert_eq!(payload.character_count, 92);
        assert!(payload.word_count > 0);
        assert_eq!(payload.reading_time_minutes, 1);
    }

    #[test]
    fn document_payload_preserves_source_and_stats() {
        let payload = super::build_document_payload("one two\nthree\n", true);

        assert_eq!(payload.source, "one two\nthree\n");
        assert_eq!(payload.line_count, 3);
        assert_eq!(payload.character_count, 14);
        assert_eq!(payload.word_count, 3);
        assert_eq!(payload.reading_time_minutes, 1);
    }

    #[test]
    fn document_payload_serializes_the_frontend_contract() {
        let payload = super::build_document_payload("# Title\nBody", true);
        let serialized = serde_json::to_value(payload).expect("payload should serialize");

        assert_eq!(serialized["source"], "# Title\nBody");
        assert_eq!(serialized["lineCount"], 2);
        assert_eq!(serialized["characterCount"], 12);
        assert!(serialized.get("line_count").is_none());
    }

    #[test]
    fn open_file_request_serializes_the_frontend_contract() {
        let request = super::OpenFileRequest {
            id: 7,
            paths: vec!["/tmp/guide.md".to_string()],
        };
        let serialized = serde_json::to_value(request).expect("request should serialize");

        assert_eq!(serialized["id"], 7);
        assert_eq!(serialized["paths"][0], "/tmp/guide.md");
    }

    #[test]
    fn supported_extensions_are_case_insensitive() {
        assert!(is_supported_extension(Path::new("README.md")));
        assert!(is_supported_extension(Path::new("GUIDE.MARKDOWN")));
        assert!(is_supported_extension(Path::new("notes.TxT")));
        assert!(!is_supported_extension(Path::new("archive.zip")));
    }

    #[test]
    fn file_size_label_is_human_readable() {
        assert_eq!(file_size_label(1024 * 1024), "1.0 MiB");
        assert_eq!(file_size_label(5 * 1024 * 1024), "5.0 MiB");
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
