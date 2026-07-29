use std::path::Path;

use tauri::ipc::Response;

use crate::document_access::read_document_image;

#[tauri::command]
pub fn get_image_bytes(document_path: String, relative_source: String) -> Result<Response, String> {
    Ok(Response::new(read_document_image(
        Path::new(&document_path),
        &relative_source,
    )?))
}
