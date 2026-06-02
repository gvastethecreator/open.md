use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::env;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use syntect::highlighting::ThemeSet;
use syntect::html::highlighted_html_for_string;
use syntect::parsing::SyntaxSet;
use tauri::AppHandle;

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);
static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
static THEME_SET: OnceLock<ThemeSet> = OnceLock::new();

const MAX_RENDERABLE_FILE_SIZE_BYTES: u64 = 20 * 1024 * 1024;

#[tauri::command]
fn get_file_content(window: tauri::Window, path: Option<String>) -> Result<String, String> {
    // If a path was explicitly passed
    if let Some(file_path) = path {
        if !file_path.is_empty() {
            return process_file(&file_path);
        }
    }

    // Only use command line arguments for the main window
    if window.label() == "main" {
        // Get command line arguments
        let args: Vec<String> = env::args().collect();

        // If an argument is provided (the file path to open)
        if args.len() > 1 {
            let file_path = &args[1];

            // Skip arguments that look like Tauri flags
            if !file_path.starts_with("--") {
                return process_file(file_path);
            }
        }
    }

    get_welcome_content()
}

#[tauri::command]
fn open_new_window(app: AppHandle, path: String) -> Result<(), String> {
    let counter = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("window-{}", counter);
    let url = format!("index.html?file={}", urlencoding::encode(&path));

    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App(url.into()))
        .title("OpenMD")
        .inner_size(900.0, 700.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn syntax_set() -> &'static SyntaxSet {
    SYNTAX_SET.get_or_init(SyntaxSet::load_defaults_newlines)
}

fn theme_set() -> &'static ThemeSet {
    THEME_SET.get_or_init(ThemeSet::load_defaults)
}

fn is_supported_extension(file_path: &Path) -> bool {
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

fn file_size_label(bytes: u64) -> String {
    const MIB: f64 = 1024.0 * 1024.0;
    format!("{:.1} MiB", bytes as f64 / MIB)
}

fn user_friendly_read_error(error: std::io::Error) -> String {
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

fn process_file(file_path: &str) -> Result<String, String> {
    let canonical_path = fs::canonicalize(file_path).map_err(user_friendly_read_error)?;

    if !is_supported_extension(&canonical_path) {
        return Err(format!(
            "Unsupported file format: {}",
            canonical_path.display()
        ));
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
        Some("md") | Some("markdown") => Ok(render_markdown_with_highlighting(&content)),
        Some("txt") => Ok(format!(
            "<pre><code>{}</code></pre>",
            html_escape::encode_text(&content)
        )),
        _ => Err(format!(
            "Unsupported file format: {}",
            canonical_path.display()
        )),
    }
}

fn get_welcome_content() -> Result<String, String> {
    let welcome = "# Welcome to OpenMD\n\nDrag a `.md` or `.txt` file here, or open the application with a file.";
    Ok(render_markdown_with_highlighting(welcome))
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

    let parser = Parser::new_ext(content, options).filter_map(|event| match event {
        Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(ref lang))) => {
            in_code_block = true;
            code_block_lang = lang.to_string();
            code_block_content.clear();
            None
        }
        Event::Start(Tag::CodeBlock(CodeBlockKind::Indented)) => {
            in_code_block = true;
            code_block_lang = String::new();
            code_block_content.clear();
            None
        }
        Event::End(TagEnd::CodeBlock) => {
            in_code_block = false;

            if code_block_lang == "mermaid" {
                let html = format!(
                    "<div class=\"mermaid\">{}</div>",
                    html_escape::encode_text(&code_block_content)
                );
                Some(Event::Html(html.into()))
            } else {
                let syntax = if !code_block_lang.is_empty() {
                    ps.find_syntax_by_token(&code_block_lang)
                        .unwrap_or_else(|| ps.find_syntax_plain_text())
                } else {
                    ps.find_syntax_plain_text()
                };

                let html = highlighted_html_for_string(&code_block_content, &ps, syntax, theme)
                    .unwrap_or_else(|_| {
                        format!(
                            "<pre><code>{}</code></pre>",
                            html_escape::encode_text(&code_block_content)
                        )
                    });

                Some(Event::Html(html.into()))
            }
        }
        Event::Text(ref text) if in_code_block => {
            code_block_content.push_str(text);
            None
        }
        _ => Some(event),
    });

    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.len() > 1 {
                let file_path = &args[1];
                if !file_path.starts_with("--") {
                    let counter = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
                    let label = format!("window-{}", counter);
                    let url = format!("index.html?file={}", urlencoding::encode(file_path));

                    let _ = tauri::WebviewWindowBuilder::new(
                        app,
                        label,
                        tauri::WebviewUrl::App(url.into()),
                    )
                    .title("OpenMD")
                    .inner_size(900.0, 700.0)
                    .center()
                    .build();
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![get_file_content, open_new_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        file_size_label, get_welcome_content, is_supported_extension,
        render_markdown_with_highlighting,
    };
    use std::path::Path;

    #[test]
    fn renders_headings_and_paragraphs() {
        let html = render_markdown_with_highlighting("# Hello\n\nSimple text");

        assert!(html.contains("<h1>Hello</h1>"));
        assert!(html.contains("<p>Simple text</p>"));
    }

    #[test]
    fn renders_mermaid_blocks_with_wrapper() {
        let html = render_markdown_with_highlighting("```mermaid\ngraph TD\nA-->B\n```");

        assert!(html.contains("<div class=\"mermaid\">"));
        assert!(html.contains("graph TD"));
    }

    #[test]
    fn welcome_content_mentions_supported_files() {
        let html = get_welcome_content().expect("welcome content should render");

        assert!(html.contains("OpenMD"));
        assert!(html.contains(".md"));
        assert!(html.contains(".txt"));
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
}
