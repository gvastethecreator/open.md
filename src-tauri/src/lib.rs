use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};
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
const MAX_LOCAL_IMAGE_SIZE_BYTES: u64 = 12 * 1024 * 1024;

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

#[tauri::command]
fn get_image_data(document_path: String, relative_source: String) -> Result<String, String> {
    let document_path = fs::canonicalize(document_path).map_err(user_friendly_read_error)?;
    if !is_supported_extension(&document_path) {
        return Err("Images can only be loaded for an open Markdown or text document.".to_string());
    }

    let document_directory = document_path
        .parent()
        .ok_or_else(|| "The document folder is unavailable.".to_string())?;
    let relative_path = safe_relative_image_path(&relative_source)?;
    let image_path = fs::canonicalize(document_directory.join(relative_path))
        .map_err(|_| "The local image is unavailable.".to_string())?;

    // Keep local document content inside its own directory, including through symlinks.
    if !image_path.starts_with(document_directory) {
        return Err("The image is outside the document folder.".to_string());
    }

    let mime_type = image_mime_type(&image_path)
        .ok_or_else(|| "This local image format is not supported.".to_string())?;
    let metadata = fs::metadata(&image_path).map_err(user_friendly_read_error)?;
    if metadata.len() > MAX_LOCAL_IMAGE_SIZE_BYTES {
        return Err(format!(
            "The local image is too large ({}). Current limit: {}.",
            file_size_label(metadata.len()),
            file_size_label(MAX_LOCAL_IMAGE_SIZE_BYTES)
        ));
    }

    let bytes = fs::read(image_path).map_err(user_friendly_read_error)?;
    Ok(format!(
        "data:{mime_type};base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
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

fn initial_file_path(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|argument| !argument.is_empty() && !argument.starts_with("--"))
        .cloned()
}

fn safe_relative_image_path(source: &str) -> Result<PathBuf, String> {
    let without_fragment = source.split('#').next().unwrap_or_default();
    let without_query = without_fragment.split('?').next().unwrap_or_default();
    let decoded = urlencoding::decode(without_query)
        .map_err(|_| "The local image path is invalid.".to_string())?;
    let normalized = decoded.replace('\\', "/");
    let path = Path::new(&normalized);

    if normalized.is_empty()
        || normalized.starts_with("//")
        || normalized.contains("://")
        || normalized.contains(':')
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Only images inside the document folder can be loaded.".to_string());
    }

    Ok(path.to_path_buf())
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("bmp") => Some("image/bmp"),
        Some("avif") => Some("image/avif"),
        _ => None,
    }
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
        Some("md") | Some("markdown") => Ok(render_markdown_with_highlighting(&content)),
        Some("txt") => Ok(format!(
            "<pre><code>{}</code></pre>",
            html_escape::encode_text(&content)
        )),
        _ => {
            Err("Unsupported file format. Open a .md, .markdown or .txt file instead.".to_string())
        }
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
        Event::Html(raw_html) | Event::InlineHtml(raw_html) => Some(Event::Text(raw_html)),
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
        .invoke_handler(tauri::generate_handler![
            get_file_content,
            get_initial_file_path,
            get_image_data,
            open_new_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        file_size_label, get_image_data, get_welcome_content, image_mime_type, initial_file_path,
        is_supported_extension, render_markdown_with_highlighting, safe_relative_image_path,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

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

    #[test]
    fn local_image_paths_stay_inside_the_document_folder() {
        assert_eq!(
            safe_relative_image_path("assets/diagram%20one.png?raw=1#preview").unwrap(),
            PathBuf::from("assets/diagram one.png")
        );
        assert!(safe_relative_image_path("../secret.png").is_err());
        assert!(safe_relative_image_path("..%2Fsecret.png").is_err());
        assert!(safe_relative_image_path("https://example.com/image.png").is_err());
        assert!(safe_relative_image_path("file:outside.png").is_err());
        assert!(safe_relative_image_path("/absolute/image.png").is_err());
    }

    #[test]
    fn local_image_mime_types_are_explicit() {
        assert_eq!(image_mime_type(Path::new("cover.PNG")), Some("image/png"));
        assert_eq!(image_mime_type(Path::new("photo.jpeg")), Some("image/jpeg"));
        assert_eq!(image_mime_type(Path::new("vector.svg")), None);
        assert_eq!(image_mime_type(Path::new("payload.html")), None);
    }

    #[test]
    fn loads_a_bounded_image_from_the_document_directory() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos();
        let fixture_directory =
            std::env::temp_dir().join(format!("openmd-image-test-{}-{unique}", std::process::id()));
        let assets_directory = fixture_directory.join("assets");
        fs::create_dir_all(&assets_directory).expect("fixture directory should be created");

        let document_path = fixture_directory.join("sample.md");
        let image_path = assets_directory.join("pixel.png");
        fs::write(&document_path, "![Pixel](assets/pixel.png)")
            .expect("fixture document should be written");
        fs::write(&image_path, [0x89, b'P', b'N', b'G']).expect("fixture image should be written");

        let data_url = get_image_data(
            document_path.to_string_lossy().into_owned(),
            "assets/pixel.png".to_string(),
        )
        .expect("local image should load");

        assert_eq!(data_url, "data:image/png;base64,iVBORw==");
        assert!(get_image_data(
            document_path.to_string_lossy().into_owned(),
            "../outside.png".to_string()
        )
        .is_err());

        fs::remove_dir_all(fixture_directory).expect("fixture directory should be removed");
    }
}
