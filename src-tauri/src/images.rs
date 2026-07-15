use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::ipc::Response;

const MAX_LOCAL_IMAGE_SIZE_BYTES: u64 = 12 * 1024 * 1024;

#[tauri::command]
pub fn get_image_bytes(document_path: String, relative_source: String) -> Result<Response, String> {
    Ok(Response::new(load_image_bytes(
        document_path,
        relative_source,
    )?))
}

fn load_image_bytes(document_path: String, relative_source: String) -> Result<Vec<u8>, String> {
    let document_path = fs::canonicalize(document_path).map_err(super::user_friendly_read_error)?;
    if !super::is_supported_extension(&document_path) {
        return Err("Images can only be loaded for an open Markdown or text document.".to_string());
    }

    let document_directory = document_path
        .parent()
        .ok_or_else(|| "The document folder is unavailable.".to_string())?;
    let relative_path = safe_relative_image_path(&relative_source)?;
    let image_path = fs::canonicalize(document_directory.join(relative_path))
        .map_err(|_| "The local image is unavailable.".to_string())?;

    if !image_path.starts_with(document_directory) {
        return Err("The image is outside the document folder.".to_string());
    }

    image_mime_type(&image_path)
        .ok_or_else(|| "This local image format is not supported.".to_string())?;
    let metadata = fs::metadata(&image_path).map_err(super::user_friendly_read_error)?;
    if metadata.len() > MAX_LOCAL_IMAGE_SIZE_BYTES {
        return Err(format!(
            "The local image is too large ({}). Current limit: {}.",
            super::file_size_label(metadata.len()),
            super::file_size_label(MAX_LOCAL_IMAGE_SIZE_BYTES)
        ));
    }

    let bytes = fs::read(image_path).map_err(super::user_friendly_read_error)?;
    Ok(bytes)
}

pub(crate) fn safe_relative_image_path(source: &str) -> Result<PathBuf, String> {
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

pub(crate) fn image_mime_type(path: &Path) -> Option<&'static str> {
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

#[cfg(test)]
mod tests {
    use super::{get_image_bytes, image_mime_type, load_image_bytes, safe_relative_image_path};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

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
    fn loads_raw_bounded_image_bytes_from_the_document_directory() {
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

        assert_eq!(
            load_image_bytes(
                document_path.to_string_lossy().into_owned(),
                "assets/pixel.png".to_string(),
            )
            .expect("local image bytes should load"),
            [0x89, b'P', b'N', b'G']
        );
        assert!(get_image_bytes(
            document_path.to_string_lossy().into_owned(),
            "assets/pixel.png".to_string(),
        )
        .is_ok());
        assert!(get_image_bytes(
            document_path.to_string_lossy().into_owned(),
            "../outside.png".to_string()
        )
        .is_err());

        fs::remove_dir_all(fixture_directory).expect("fixture directory should be removed");
    }
}
