use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::env;
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use syntect::highlighting::ThemeSet;
use syntect::html::highlighted_html_for_string;
use syntect::parsing::SyntaxSet;
use tauri::AppHandle;

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(1);

#[tauri::command]
fn get_file_content(path: Option<String>) -> Result<String, String> {
    // If a path was explicitly passed
    if let Some(file_path) = path {
        if !file_path.is_empty() {
            return process_file(&file_path);
        }
    }

    // Get command line arguments
    let args: Vec<String> = env::args().collect();

    // If an argument is provided (the file path to open)
    if args.len() > 1 {
        let file_path = &args[1];

        // Skip arguments that look like Tauri flags
        if file_path.starts_with("--") {
            get_welcome_content()
        } else {
            process_file(file_path)
        }
    } else {
        get_welcome_content()
    }
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

fn process_file(file_path: &str) -> Result<String, String> {
    match fs::read_to_string(file_path) {
        Ok(content) => {
            if file_path.ends_with(".md") || file_path.ends_with(".markdown") {
                Ok(render_markdown_with_highlighting(&content))
            } else if file_path.ends_with(".txt") {
                // Just wrap txt in pre/code tags
                Ok(format!(
                    "<pre><code>{}</code></pre>",
                    html_escape::encode_text(&content)
                ))
            } else {
                Err(format!("Formato de archivo no soportado: {}", file_path))
            }
        }
        Err(e) => Err(format!("Error leyendo el archivo: {}", e)),
    }
}

fn get_welcome_content() -> Result<String, String> {
    let welcome = "# Bienvenido a OpenMD\n\nArrastra un archivo `.md` o `.txt` aquí, o abre la aplicación con un archivo.";
    Ok(render_markdown_with_highlighting(welcome))
}

fn render_markdown_with_highlighting(content: &str) -> String {
    let ps = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();
    let theme = &ts.themes["base16-ocean.dark"];

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
    use super::{get_welcome_content, render_markdown_with_highlighting};

    #[test]
    fn renders_headings_and_paragraphs() {
        let html = render_markdown_with_highlighting("# Hola\n\nTexto simple");

        assert!(html.contains("<h1>Hola</h1>"));
        assert!(html.contains("<p>Texto simple</p>"));
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
}
