use pulldown_cmark::{html, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use syntect::highlighting::ThemeSet;
use syntect::html::highlighted_html_for_string;
use syntect::parsing::SyntaxSet;

const MAX_RENDERABLE_FILE_SIZE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_LOCAL_IMAGE_SIZE_BYTES: u64 = 12 * 1024 * 1024;
const READING_WORDS_PER_MINUTE: usize = 220;

static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
static THEME_SET: OnceLock<ThemeSet> = OnceLock::new();
static SAVE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentPayload {
    html: String,
    source: String,
    line_count: usize,
    character_count: usize,
    word_count: usize,
    reading_time_minutes: usize,
}

pub(crate) fn open_document(file_path: &Path) -> Result<DocumentPayload, String> {
    recover_interrupted_save(file_path)?;
    let canonical_path = fs::canonicalize(file_path).map_err(user_friendly_read_error)?;

    if !is_supported_document(&canonical_path) {
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

    let is_markdown = matches!(
        canonical_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("markdown")
    );
    Ok(build_document_payload(&content, is_markdown))
}

pub(crate) fn save_document(file_path: &Path, content: &str) -> Result<DocumentPayload, String> {
    recover_interrupted_save(file_path)?;
    let canonical_path = fs::canonicalize(file_path).map_err(user_friendly_write_error)?;
    if !is_supported_document(&canonical_path) {
        return Err(
            "Unsupported file format. Save a .md, .markdown or .txt file instead.".to_string(),
        );
    }

    let content_size = content.len() as u64;
    if content_size > MAX_RENDERABLE_FILE_SIZE_BYTES {
        return Err(format!(
            "The edited document is too large to save ({}). Current limit: {}.",
            file_size_label(content_size),
            file_size_label(MAX_RENDERABLE_FILE_SIZE_BYTES)
        ));
    }

    let parent = canonical_path
        .parent()
        .ok_or_else(|| "The document folder is unavailable.".to_string())?;
    let file_name = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The document name is invalid.".to_string())?;
    let nonce = SAVE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary_path = parent.join(format!(
        ".{file_name}.openmd-{}-{nonce}.tmp",
        std::process::id()
    ));

    let result: Result<(), String> = (|| {
        let mut temporary = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(user_friendly_write_error)?;
        temporary
            .write_all(content.as_bytes())
            .and_then(|_| temporary.sync_all())
            .map_err(user_friendly_write_error)?;

        if let Ok(metadata) = fs::metadata(&canonical_path) {
            fs::set_permissions(&temporary_path, metadata.permissions())
                .map_err(user_friendly_write_error)?;
        }

        replace_document_file(&temporary_path, &canonical_path, nonce)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result?;

    let is_markdown = matches!(
        canonical_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("markdown")
    );
    Ok(build_document_payload(content, is_markdown))
}

#[cfg(not(target_os = "windows"))]
fn replace_document_file(
    temporary_path: &Path,
    destination: &Path,
    _nonce: u64,
) -> Result<(), String> {
    fs::rename(temporary_path, destination).map_err(user_friendly_write_error)
}

#[cfg(target_os = "windows")]
fn replace_document_file(
    temporary_path: &Path,
    destination: &Path,
    nonce: u64,
) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "The document folder is unavailable.".to_string())?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The document name is invalid.".to_string())?;
    let backup_path = parent.join(format!(
        ".{file_name}.openmd-{}-{nonce}.backup",
        std::process::id()
    ));

    fs::rename(destination, &backup_path).map_err(user_friendly_write_error)?;
    if let Err(error) = fs::rename(temporary_path, destination) {
        let _ = fs::rename(&backup_path, destination);
        return Err(user_friendly_write_error(error));
    }
    fs::remove_file(backup_path).map_err(user_friendly_write_error)
}

#[cfg(not(target_os = "windows"))]
fn recover_interrupted_save(_destination: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn recover_interrupted_save(destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Ok(());
    }
    let Some(parent) = destination.parent() else {
        return Ok(());
    };
    let Some(file_name) = destination.file_name().and_then(|name| name.to_str()) else {
        return Ok(());
    };
    let prefix = format!(".{file_name}.openmd-");
    let mut backups = match fs::read_dir(parent) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with(&prefix) && name.ends_with(".backup")
            })
            .collect::<Vec<_>>(),
        Err(_) => return Ok(()),
    };
    backups.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    let Some(latest) = backups.pop() else {
        return Ok(());
    };
    fs::rename(latest.path(), destination).map_err(user_friendly_write_error)
}

pub(crate) fn read_document_image(
    document_path: &Path,
    relative_source: &str,
) -> Result<Vec<u8>, String> {
    let document_path = fs::canonicalize(document_path).map_err(user_friendly_read_error)?;
    if !is_supported_document(&document_path) {
        return Err("Images can only be loaded for an open Markdown or text document.".to_string());
    }

    let document_directory = document_path
        .parent()
        .ok_or_else(|| "The document folder is unavailable.".to_string())?;
    let relative_path = safe_relative_image_path(relative_source)?;
    let image_path = fs::canonicalize(document_directory.join(relative_path))
        .map_err(|_| "The local image is unavailable.".to_string())?;

    if !image_path.starts_with(document_directory) {
        return Err("The image is outside the document folder.".to_string());
    }

    image_mime_type(&image_path)
        .ok_or_else(|| "This local image format is not supported.".to_string())?;
    let metadata = fs::metadata(&image_path).map_err(user_friendly_read_error)?;
    if metadata.len() > MAX_LOCAL_IMAGE_SIZE_BYTES {
        return Err(format!(
            "The local image is too large ({}). Current limit: {}.",
            file_size_label(metadata.len()),
            file_size_label(MAX_LOCAL_IMAGE_SIZE_BYTES)
        ));
    }

    fs::read(image_path).map_err(user_friendly_read_error)
}

pub(crate) fn is_supported_document(file_path: &Path) -> bool {
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
        _ => format!("Could not read the file: {error}"),
    }
}

fn user_friendly_write_error(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "The file is no longer available.".to_string(),
        std::io::ErrorKind::PermissionDenied => {
            "The file is read-only or open.md does not have permission to save it.".to_string()
        }
        std::io::ErrorKind::AlreadyExists => {
            "A temporary save file already exists. Try saving again.".to_string()
        }
        _ => format!("The file could not be saved: {error}"),
    }
}

fn syntax_set() -> &'static SyntaxSet {
    SYNTAX_SET.get_or_init(SyntaxSet::load_defaults_newlines)
}

fn theme_set() -> &'static ThemeSet {
    THEME_SET.get_or_init(ThemeSet::load_defaults)
}

fn build_document_payload(content: &str, is_markdown: bool) -> DocumentPayload {
    let word_count = content.split_whitespace().count();
    let reading_time_minutes = if word_count == 0 {
        0
    } else {
        (word_count + READING_WORDS_PER_MINUTE - 1) / READING_WORDS_PER_MINUTE
    };

    let html = if is_markdown {
        render_markdown(content)
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

fn render_markdown(content: &str) -> String {
    let syntax_set = syntax_set();
    let theme_set = theme_set();
    let theme = theme_set
        .themes
        .get("base16-ocean.dark")
        .unwrap_or_else(|| {
            theme_set
                .themes
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
                            syntax_set
                                .find_syntax_by_token(&code_block_lang)
                                .unwrap_or_else(|| syntax_set.find_syntax_plain_text())
                        } else {
                            syntax_set.find_syntax_plain_text()
                        };

                        let html = highlighted_html_for_string(
                            &code_block_content,
                            syntax_set,
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
                Event::TaskListMarker(checked) => {
                    let source_line = source_line_for_offset(&line_starts, source_range.start);
                    let checked_attribute = if checked { " checked" } else { "" };
                    output.push(Event::Html(
                        format!(
                            "<input type=\"checkbox\" data-source-line=\"{source_line}\" aria-label=\"{}\"{checked_attribute}>",
                            if checked {
                                "Mark task incomplete"
                            } else {
                                "Mark task complete"
                            }
                        )
                        .into(),
                    ));
                }
                _ => output.push(event),
            }

            output
        });

    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

#[cfg(test)]
mod tests {
    use super::{
        build_document_payload, file_size_label, image_mime_type, is_supported_document,
        open_document, read_document_image, render_markdown, safe_relative_image_path,
        save_document, MAX_LOCAL_IMAGE_SIZE_BYTES, MAX_RENDERABLE_FILE_SIZE_BYTES,
    };
    use std::fs::{self, File};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FixtureDirectory(PathBuf);

    impl FixtureDirectory {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be available")
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("openmd-{label}-{}-{unique}", std::process::id()));
            fs::create_dir_all(&path).expect("fixture directory should be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for FixtureDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn opens_markdown_and_text_documents_with_stable_metadata() {
        let fixture = FixtureDirectory::new("documents");
        let markdown_path = fixture.path().join("guide.md");
        let text_path = fixture.path().join("notes.txt");
        fs::write(&markdown_path, "# Guide\n\nOne two").expect("markdown should be written");
        fs::write(&text_path, "<script>alert(1)</script>").expect("text should be written");

        let markdown = open_document(&markdown_path).expect("markdown should open");
        assert!(markdown.html.contains("<h1>Guide</h1>"));
        assert_eq!(markdown.source, "# Guide\n\nOne two");
        assert_eq!(markdown.line_count, 3);
        assert_eq!(markdown.word_count, 4);
        assert_eq!(markdown.reading_time_minutes, 1);

        let text = open_document(&text_path).expect("text should open");
        assert!(text.html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(!text.html.contains("<script>"));
    }

    #[test]
    fn rejects_invalid_utf8_unsupported_extensions_and_oversized_documents() {
        let fixture = FixtureDirectory::new("invalid-documents");
        let invalid_utf8 = fixture.path().join("invalid.md");
        let unsupported = fixture.path().join("page.html");
        let oversized = fixture.path().join("large.md");
        fs::write(&invalid_utf8, [0xff, 0xfe]).expect("invalid bytes should be written");
        fs::write(&unsupported, "<p>no</p>").expect("unsupported file should be written");
        File::create(&oversized)
            .expect("large file should be created")
            .set_len(MAX_RENDERABLE_FILE_SIZE_BYTES + 1)
            .expect("large sparse file should be sized");

        assert!(open_document(&invalid_utf8)
            .unwrap_err()
            .contains("not in UTF-8"));
        assert!(open_document(&unsupported)
            .unwrap_err()
            .contains("Unsupported file format"));
        assert!(open_document(&oversized).unwrap_err().contains("too large"));
    }

    #[test]
    fn saves_supported_documents_and_returns_the_updated_render_contract() {
        let fixture = FixtureDirectory::new("save-document");
        let markdown_path = fixture.path().join("guide.md");
        fs::write(&markdown_path, "# Before").expect("fixture should be written");

        let saved = save_document(&markdown_path, "# After\n\n- [x] Saved")
            .expect("supported document should save");

        assert_eq!(
            fs::read_to_string(&markdown_path).unwrap(),
            "# After\n\n- [x] Saved"
        );
        assert_eq!(saved.source, "# After\n\n- [x] Saved");
        assert!(saved.html.contains("<h1>After</h1>"));
        assert_eq!(saved.line_count, 3);
        assert!(!fixture.path().read_dir().unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("openmd-")
        }));
    }

    #[test]
    fn rejects_unsupported_missing_and_oversized_save_targets_without_changing_files() {
        let fixture = FixtureDirectory::new("save-rejections");
        let unsupported = fixture.path().join("page.html");
        let supported = fixture.path().join("notes.md");
        let missing = fixture.path().join("missing.md");
        fs::write(&unsupported, "keep").unwrap();
        fs::write(&supported, "keep").unwrap();
        let oversized = "x".repeat(MAX_RENDERABLE_FILE_SIZE_BYTES as usize + 1);

        assert!(save_document(&unsupported, "replace")
            .unwrap_err()
            .contains("Unsupported"));
        assert!(save_document(&missing, "replace")
            .unwrap_err()
            .contains("no longer"));
        assert!(save_document(&supported, &oversized)
            .unwrap_err()
            .contains("too large"));
        assert_eq!(fs::read_to_string(&unsupported).unwrap(), "keep");
        assert_eq!(fs::read_to_string(&supported).unwrap(), "keep");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn recovers_a_backup_left_between_windows_replace_steps() {
        let fixture = FixtureDirectory::new("recover-save");
        let document_path = fixture.path().join("notes.md");
        let backup_path = fixture.path().join(".notes.md.openmd-123-1.backup");
        fs::write(&backup_path, "# Recovered").unwrap();

        let recovered = open_document(&document_path).expect("backup should be restored");

        assert_eq!(recovered.source, "# Recovered");
        assert_eq!(fs::read_to_string(&document_path).unwrap(), "# Recovered");
        assert!(!backup_path.exists());
    }

    #[test]
    fn document_payload_serializes_the_frontend_contract() {
        let payload = build_document_payload("# Title\nBody", true);
        let serialized = serde_json::to_value(payload).expect("payload should serialize");

        assert_eq!(serialized["source"], "# Title\nBody");
        assert_eq!(serialized["lineCount"], 2);
        assert_eq!(serialized["characterCount"], 12);
        assert!(serialized.get("line_count").is_none());
    }

    #[test]
    fn markdown_rendering_escapes_html_and_preserves_mermaid_wrappers() {
        let escaped = render_markdown("<style>body { display: none; }</style>");
        assert!(!escaped.contains("<style>"));
        assert!(escaped.contains("&lt;style&gt;"));

        let mermaid = render_markdown("```mermaid\ngraph TD\nA-->B\n```");
        assert!(mermaid.contains("<div class=\"mermaid\">"));
        assert!(mermaid.contains("graph TD"));

        let tasks = render_markdown("- [ ] First\n- [x] Second");
        assert!(tasks.contains(
            "<input type=\"checkbox\" data-source-line=\"1\" aria-label=\"Mark task complete\">"
        ));
        assert!(tasks.contains(
            "<input type=\"checkbox\" data-source-line=\"2\" aria-label=\"Mark task incomplete\" checked>"
        ));
        assert!(!tasks.contains("disabled"));
    }

    #[test]
    fn document_and_resource_file_policies_are_explicit() {
        assert!(is_supported_document(Path::new("README.MD")));
        assert!(is_supported_document(Path::new("notes.TxT")));
        assert!(!is_supported_document(Path::new("page.html")));
        assert_eq!(image_mime_type(Path::new("cover.PNG")), Some("image/png"));
        assert_eq!(image_mime_type(Path::new("vector.svg")), None);
        assert_eq!(file_size_label(5 * 1024 * 1024), "5.0 MiB");
    }

    #[test]
    fn relative_resource_paths_cannot_escape_the_document_folder() {
        assert_eq!(
            safe_relative_image_path("assets/diagram%20one.png?raw=1#preview").unwrap(),
            PathBuf::from("assets/diagram one.png")
        );
        for source in [
            "../secret.png",
            "..%2Fsecret.png",
            "https://example.com/image.png",
            "file:outside.png",
            "/absolute/image.png",
        ] {
            assert!(
                safe_relative_image_path(source).is_err(),
                "accepted {source}"
            );
        }
    }

    #[test]
    fn reads_only_supported_bounded_images_for_supported_documents() {
        let fixture = FixtureDirectory::new("resources");
        let assets = fixture.path().join("assets");
        fs::create_dir_all(&assets).expect("assets directory should be created");
        let document_path = fixture.path().join("sample.md");
        let unsupported_document = fixture.path().join("sample.html");
        let image_path = assets.join("pixel.png");
        let unsupported_image = assets.join("vector.svg");
        let oversized_image = assets.join("large.png");
        fs::write(&document_path, "![Pixel](assets/pixel.png)")
            .expect("document should be written");
        fs::write(&unsupported_document, "no").expect("unsupported document should be written");
        fs::write(&image_path, [0x89, b'P', b'N', b'G']).expect("image should be written");
        fs::write(&unsupported_image, "<svg/>").expect("svg should be written");
        File::create(&oversized_image)
            .expect("large image should be created")
            .set_len(MAX_LOCAL_IMAGE_SIZE_BYTES + 1)
            .expect("large sparse image should be sized");

        assert_eq!(
            read_document_image(&document_path, "assets/pixel.png")
                .expect("image bytes should load"),
            [0x89, b'P', b'N', b'G']
        );
        assert!(read_document_image(&unsupported_document, "assets/pixel.png").is_err());
        assert!(read_document_image(&document_path, "assets/vector.svg").is_err());
        assert!(read_document_image(&document_path, "assets/large.png")
            .unwrap_err()
            .contains("too large"));
        assert!(read_document_image(&document_path, "../outside.png").is_err());
    }
}
