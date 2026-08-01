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
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'static str>,
}

const HEADER_SNIFF_BYTES: usize = 512;

pub(crate) fn open_document(file_path: &Path) -> Result<DocumentPayload, String> {
    recover_interrupted_save(file_path)?;
    let canonical_path = fs::canonicalize(file_path).map_err(user_friendly_read_error)?;

    if !is_supported_document(&canonical_path) {
        return Err(
            "Unsupported file format. Open a Markdown, text, or image file instead.".to_string(),
        );
    }

    let metadata = fs::metadata(&canonical_path).map_err(user_friendly_read_error)?;
    let header = read_file_header(&canonical_path, HEADER_SNIFF_BYTES)?;
    let resolved = resolve_document_format(&canonical_path, Some(&header));

    if let Some(message) = resolved.fail_closed {
        return Err(message.to_string());
    }

    if resolved.kind == "image" {
        return open_image_document_with_format(&canonical_path, resolved.format, resolved.mime);
    }

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

    Ok(build_document_payload(
        &content,
        resolved.kind == "markdown",
        resolved.kind,
        resolved.format,
    ))
}

/// Write arbitrary bytes to a user-chosen path (image download / export).
/// Size-capped to the local image budget. Does not open or re-read the document.
pub(crate) fn save_bytes(file_path: &Path, bytes: &[u8]) -> Result<(), String> {
    let content_size = bytes.len() as u64;
    if content_size > MAX_LOCAL_IMAGE_SIZE_BYTES {
        return Err(format!(
            "The file is too large to save ({}). Current limit: {}.",
            file_size_label(content_size),
            file_size_label(MAX_LOCAL_IMAGE_SIZE_BYTES)
        ));
    }

    let parent = file_path
        .parent()
        .filter(|path| path.as_os_str().len() > 0)
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "The destination folder is unavailable.".to_string())?;

    if !parent.exists() {
        return Err("The destination folder is unavailable.".to_string());
    }

    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The destination name is invalid.".to_string())?;
    let nonce = SAVE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary_path = parent.join(format!(
        ".{file_name}.openmd-export-{}-{nonce}.tmp",
        std::process::id()
    ));
    let destination = parent.join(file_name);

    let result: Result<(), String> = (|| {
        let mut temporary = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(user_friendly_write_error)?;
        temporary
            .write_all(bytes)
            .and_then(|_| temporary.sync_all())
            .map_err(user_friendly_write_error)?;
        if destination.exists() {
            replace_document_file(&temporary_path, &destination, nonce)?;
        } else {
            fs::rename(&temporary_path, &destination).map_err(user_friendly_write_error)?;
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

pub(crate) fn save_document(file_path: &Path, content: &str) -> Result<DocumentPayload, String> {
    recover_interrupted_save(file_path)?;
    let canonical_path = fs::canonicalize(file_path).map_err(user_friendly_write_error)?;
    if !is_editable_document(&canonical_path) {
        return Err("Unsupported file format. Save a Markdown or text file instead.".to_string());
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

    let format = text_format_from_path(&canonical_path);
    let kind = if is_markdown_document(&canonical_path) {
        "markdown"
    } else {
        "text"
    };
    Ok(build_document_payload(
        content,
        kind == "markdown",
        kind,
        format,
    ))
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
    if !is_text_document(&document_path) {
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

fn document_extension(file_path: &Path) -> Option<String> {
    file_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
}

/// Product-surface Markdown: rich render and primary associations.
fn is_markdown_document(file_path: &Path) -> bool {
    matches!(
        document_extension(file_path).as_deref(),
        Some("md") | Some("markdown")
    )
}

fn is_plain_text_document(file_path: &Path) -> bool {
    matches!(
        document_extension(file_path).as_deref(),
        Some("txt")
            | Some("nfo")
            | Some("json")
            | Some("ini")
            | Some("yml")
            | Some("yaml")
            | Some("toml")
            | Some("cfg")
            | Some("conf")
            | Some("log")
            | Some("csv")
            | Some("env")
    )
}

fn is_image_document(file_path: &Path) -> bool {
    image_mime_type(file_path).is_some()
}

/// Markdown or plain-text companions (editable / host relative images).
fn is_text_document(file_path: &Path) -> bool {
    is_markdown_document(file_path) || is_plain_text_document(file_path)
}

fn is_editable_document(file_path: &Path) -> bool {
    is_text_document(file_path)
}

/// Markdown, plain-text companions, and implicit image companions.
/// Companions open via drop/CLI/links; they are not OS-registered or picker-listed.
pub(crate) fn is_supported_document(file_path: &Path) -> bool {
    is_text_document(file_path) || is_image_document(file_path)
}

fn open_image_document_with_format(
    file_path: &Path,
    format: &'static str,
    mime: Option<&'static str>,
) -> Result<DocumentPayload, String> {
    let mime = mime
        .or_else(|| image_mime_type(file_path))
        .ok_or_else(|| "This image format is not supported.".to_string())?;
    let metadata = fs::metadata(file_path).map_err(user_friendly_read_error)?;
    if metadata.len() > MAX_LOCAL_IMAGE_SIZE_BYTES {
        return Err(format!(
            "The image is too large for an instant view ({}). Current limit: {}.",
            file_size_label(metadata.len()),
            file_size_label(MAX_LOCAL_IMAGE_SIZE_BYTES)
        ));
    }

    // Prove the file is readable; bytes are delivered separately as a binary response.
    let _ = fs::File::open(file_path).map_err(user_friendly_read_error)?;
    let label = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Image");
    let safe_label = html_escape::encode_double_quoted_attribute(label);

    Ok(DocumentPayload {
        html: format!(
            "<div class=\"image-document\" data-image-document=\"true\" data-image-mime=\"{mime}\" data-image-format=\"{format}\" role=\"img\" aria-label=\"{safe_label}\"></div>"
        ),
        source: String::new(),
        line_count: 1,
        character_count: 0,
        word_count: 0,
        reading_time_minutes: 0,
        kind: Some("image"),
        format: Some(format),
    })
}

/// Read a standalone image file opened as a document (implicit companion).
pub(crate) fn read_standalone_image(file_path: &Path) -> Result<Vec<u8>, String> {
    let canonical_path = fs::canonicalize(file_path).map_err(user_friendly_read_error)?;
    let header = read_file_header(&canonical_path, HEADER_SNIFF_BYTES)?;
    let resolved = resolve_document_format(&canonical_path, Some(&header));
    if let Some(message) = resolved.fail_closed {
        return Err(message.to_string());
    }
    if resolved.kind != "image" {
        return Err("This image format is not supported.".to_string());
    }

    let metadata = fs::metadata(&canonical_path).map_err(user_friendly_read_error)?;
    if metadata.len() > MAX_LOCAL_IMAGE_SIZE_BYTES {
        return Err(format!(
            "The image is too large for an instant view ({}). Current limit: {}.",
            file_size_label(metadata.len()),
            file_size_label(MAX_LOCAL_IMAGE_SIZE_BYTES)
        ));
    }

    fs::read(&canonical_path).map_err(user_friendly_read_error)
}

fn read_file_header(path: &Path, max_len: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(user_friendly_read_error)?;
    let mut buffer = vec![0u8; max_len];
    let read = file.read(&mut buffer).map_err(user_friendly_read_error)?;
    buffer.truncate(read);
    Ok(buffer)
}

fn detect_image_format_from_magic(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.len() >= 2 && bytes[0] == b'B' && bytes[1] == b'M' {
        return Some("bmp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && &bytes[8..12] == b"avif" {
        return Some("avif");
    }
    None
}

fn image_mime_for_format(format: &str) -> Option<&'static str> {
    match format {
        "png" => Some("image/png"),
        "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

struct ResolvedFormat {
    kind: &'static str,
    format: &'static str,
    mime: Option<&'static str>,
    fail_closed: Option<&'static str>,
}

fn text_format_from_path(file_path: &Path) -> &'static str {
    match document_extension(file_path).as_deref() {
        Some("json") => "json",
        Some("yml") | Some("yaml") => "yaml",
        Some("toml") => "toml",
        Some("ini") | Some("cfg") | Some("conf") => "ini",
        Some("env") => "env",
        Some("csv") => "csv",
        Some("md") | Some("markdown") => "markdown",
        _ => "text",
    }
}

fn resolve_document_format(file_path: &Path, header: Option<&[u8]>) -> ResolvedFormat {
    let extension = document_extension(file_path);
    let ext = extension.as_deref();
    let magic = header.and_then(detect_image_format_from_magic);

    let is_md = matches!(ext, Some("md") | Some("markdown"));
    let is_text = is_plain_text_document(file_path) || is_md;
    let is_image_ext = image_mime_type(file_path).is_some();

    if is_image_ext {
        if header.is_some() && magic.is_none() {
            return ResolvedFormat {
                kind: "image",
                format: match ext {
                    Some("jpg") | Some("jpeg") => "jpeg",
                    Some("png") => "png",
                    Some("gif") => "gif",
                    Some("webp") => "webp",
                    Some("bmp") => "bmp",
                    Some("avif") => "avif",
                    _ => "image",
                },
                mime: image_mime_type(file_path),
                fail_closed: Some("This image file is damaged or is not a supported image format."),
            };
        }
        let format = magic.unwrap_or(match ext {
            Some("jpg") | Some("jpeg") => "jpeg",
            Some("png") => "png",
            Some("gif") => "gif",
            Some("webp") => "webp",
            Some("bmp") => "bmp",
            Some("avif") => "avif",
            _ => "image",
        });
        return ResolvedFormat {
            kind: "image",
            format,
            mime: image_mime_for_format(format).or_else(|| image_mime_type(file_path)),
            fail_closed: None,
        };
    }

    // Text/markdown companions: reclassify when content is an image.
    if is_text {
        if let Some(format) = magic {
            return ResolvedFormat {
                kind: "image",
                format,
                mime: image_mime_for_format(format),
                fail_closed: None,
            };
        }
        if is_md {
            return ResolvedFormat {
                kind: "markdown",
                format: "markdown",
                mime: None,
                fail_closed: None,
            };
        }
        let format = text_format_from_path(file_path);
        return ResolvedFormat {
            kind: "text",
            format,
            mime: None,
            fail_closed: None,
        };
    }

    ResolvedFormat {
        kind: "text",
        format: "text",
        mime: None,
        fail_closed: Some("Unsupported file format. Open a Markdown, text, or image file instead."),
    }
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

fn build_document_payload(
    content: &str,
    is_markdown: bool,
    kind: &'static str,
    format: &'static str,
) -> DocumentPayload {
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
            "<span class=\"source-line-anchor\" data-source-line=\"1\" aria-hidden=\"true\"></span><pre data-plain-text=\"true\" data-full-document-highlight=\"true\" data-format=\"{format}\"><code>{}</code></pre>",
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
        kind: Some(kind),
        format: Some(format),
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
        build_document_payload, detect_image_format_from_magic, file_size_label, image_mime_type,
        is_supported_document, open_document, read_document_image, render_markdown,
        safe_relative_image_path, save_bytes, save_document, MAX_LOCAL_IMAGE_SIZE_BYTES,
        MAX_RENDERABLE_FILE_SIZE_BYTES,
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
        let json_path = fixture.path().join("config.json");
        fs::write(&markdown_path, "# Guide\n\nOne two").expect("markdown should be written");
        fs::write(&text_path, "<script>alert(1)</script>").expect("text should be written");
        fs::write(&json_path, "{\n  \"ok\": true\n}").expect("json should be written");

        let markdown = open_document(&markdown_path).expect("markdown should open");
        assert!(markdown.html.contains("<h1>Guide</h1>"));
        assert_eq!(markdown.source, "# Guide\n\nOne two");
        assert_eq!(markdown.line_count, 3);
        assert_eq!(markdown.word_count, 4);
        assert_eq!(markdown.reading_time_minutes, 1);

        let text = open_document(&text_path).expect("text should open");
        assert!(text.html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(!text.html.contains("<script>"));

        let companion =
            open_document(&json_path).expect("companion json should open as plain text");
        assert!(companion.html.contains("data-plain-text=\"true\""));
        assert!(companion.html.contains("{"));
        assert!(!companion.html.contains("<h1>"));
        assert_eq!(companion.source, "{\n  \"ok\": true\n}");
    }

    fn sample_png() -> Vec<u8> {
        vec![
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08,
            0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe,
            0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]
    }

    #[test]
    fn opens_image_companions_as_image_kind_without_utf8_decode() {
        let fixture = FixtureDirectory::new("image-documents");
        let image_path = fixture.path().join("pixel.png");
        let png = sample_png();
        fs::write(&image_path, &png).expect("png should be written");

        let opened = open_document(&image_path).expect("image companion should open");
        assert_eq!(opened.kind, Some("image"));
        assert_eq!(opened.format, Some("png"));
        assert!(opened.html.contains("data-image-document=\"true\""));
        assert!(opened.html.contains("image/png"));
        assert_eq!(opened.source, "");

        let bytes = super::read_standalone_image(&image_path).expect("bytes should load");
        assert_eq!(bytes, png);

        assert!(save_document(&image_path, "nope")
            .unwrap_err()
            .contains("Unsupported"));
    }

    #[test]
    fn reclassifies_text_companion_with_png_magic_to_image() {
        let fixture = FixtureDirectory::new("reclassify-image");
        let path = fixture.path().join("notes.txt");
        let png = sample_png();
        fs::write(&path, &png).expect("png bytes under txt should be written");

        let opened = open_document(&path).expect("reclassified image should open");
        assert_eq!(opened.kind, Some("image"));
        assert_eq!(opened.format, Some("png"));
        assert!(opened.html.contains("data-image-document=\"true\""));

        let bytes = super::read_standalone_image(&path).expect("standalone bytes should load");
        assert_eq!(bytes, png);
    }

    #[test]
    fn fail_closes_image_extension_with_non_image_bytes() {
        let fixture = FixtureDirectory::new("bad-image");
        let path = fixture.path().join("photo.png");
        fs::write(&path, b"not an image").expect("garbage should be written");

        let err = open_document(&path).unwrap_err();
        assert!(
            err.contains("damaged") || err.contains("not a supported image"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn text_payloads_include_format_id() {
        let fixture = FixtureDirectory::new("format-ids");
        let json_path = fixture.path().join("config.json");
        fs::write(&json_path, r#"{"ok":true}"#).unwrap();
        let opened = open_document(&json_path).expect("json should open");
        assert_eq!(opened.kind, Some("text"));
        assert_eq!(opened.format, Some("json"));
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

    #[test]
    fn saves_export_bytes_and_rejects_oversized_payloads() {
        let fixture = FixtureDirectory::new("save-bytes");
        let destination = fixture.path().join("export.png");
        let payload = [0x89_u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

        save_bytes(&destination, &payload).expect("export should write");
        assert_eq!(fs::read(&destination).expect("export should exist"), payload);

        // Overwrite path uses the same atomic replace helper as document saves.
        let next = [1_u8, 2, 3, 4];
        save_bytes(&destination, &next).expect("overwrite should write");
        assert_eq!(fs::read(&destination).expect("export should update"), next);

        let oversized = vec![0_u8; MAX_LOCAL_IMAGE_SIZE_BYTES as usize + 1];
        assert!(save_bytes(&destination, &oversized)
            .unwrap_err()
            .contains("too large"));
        assert_eq!(fs::read(&destination).expect("failed export keeps prior bytes"), next);
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
        let payload = build_document_payload("# Title\nBody", true, "markdown", "markdown");
        let serialized = serde_json::to_value(payload).expect("payload should serialize");

        assert_eq!(serialized["source"], "# Title\nBody");
        assert_eq!(serialized["lineCount"], 2);
        assert_eq!(serialized["characterCount"], 12);
        assert!(serialized.get("line_count").is_none());
        assert_eq!(serialized["kind"], "markdown");
        assert_eq!(serialized["format"], "markdown");
    }

    #[test]
    fn detects_png_magic_bytes() {
        let png = sample_png();
        assert_eq!(detect_image_format_from_magic(&png), Some("png"));
        assert_eq!(detect_image_format_from_magic(b"nope"), None);
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
    fn comprehensive_example_exercises_supported_rich_content() {
        let example_path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/a-quiet-place.md");
        let example = open_document(&example_path).expect("example document should open");

        assert!(example.html.contains("<table>"));
        assert!(example.html.contains("<div class=\"mermaid\">"));
        assert!(example.html.contains("type=\"checkbox\""));
        assert!(example.html.contains("<del>completed ideas</del>"));
        assert!(example.html.contains(
            "<img src=\"assets/quiet-desk.webp\" alt=\"A blank notebook and pencil beside a rain-covered window\""
        ));
        assert!(example.html.contains("footnote-reference"));
        assert!(example.line_count > 70);

        let image = read_document_image(&example_path, "assets/quiet-desk.webp")
            .expect("example image should load through the safe resource policy");
        assert!(!image.is_empty());
    }

    #[test]
    fn document_and_resource_file_policies_are_explicit() {
        assert!(is_supported_document(Path::new("README.MD")));
        assert!(is_supported_document(Path::new("notes.TxT")));
        assert!(is_supported_document(Path::new("config.JSON")));
        assert!(is_supported_document(Path::new("setup.ini")));
        assert!(is_supported_document(Path::new("info.nfo")));
        assert!(is_supported_document(Path::new("settings.toml")));
        assert!(is_supported_document(Path::new("photo.PNG")));
        assert!(is_supported_document(Path::new("cover.webp")));
        assert!(!is_supported_document(Path::new("page.html")));
        assert!(!is_supported_document(Path::new("main.rs")));
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
