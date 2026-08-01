use serde::Serialize;
use std::process::Command;

/// Extensions registered by packaged builds (`tauri.conf.json` fileAssociations).
pub const ASSOCIATED_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAssociationStatus {
    /// Overall status for registered Markdown/text types.
    pub status: &'static str,
    pub platform: &'static str,
    pub detail: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAssociationActionResult {
    pub outcome: &'static str,
    pub detail: String,
}

fn status_base(status: &'static str, detail: impl Into<String>) -> FileAssociationStatus {
    FileAssociationStatus {
        status,
        platform: current_platform(),
        detail: detail.into(),
        extensions: ASSOCIATED_EXTENSIONS
            .iter()
            .map(|ext| (*ext).to_string())
            .collect(),
    }
}

fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        "unknown"
    }
}

pub fn get_status() -> FileAssociationStatus {
    #[cfg(target_os = "windows")]
    {
        windows_status()
    }
    #[cfg(target_os = "macos")]
    {
        status_base(
            "unknown",
            "Packaged open.md registers Markdown and text for Open With. Use System Settings or Get Info to set the default app.",
        )
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        linux_status()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        status_base(
            "unavailable",
            "File associations are not supported on this platform.",
        )
    }
}

pub fn request_association() -> Result<FileAssociationActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        windows_request()
    }
    #[cfg(target_os = "macos")]
    {
        macos_request()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        linux_request()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        Err("File associations are not supported on this platform.".into())
    }
}

#[cfg(target_os = "windows")]
fn windows_status() -> FileAssociationStatus {
    // Best-effort: UserChoice ProgId for .md when present. Defaults and store
    // apps make silent verification unreliable, so unknown remains valid.
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice",
            "/v",
            "ProgId",
        ])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            let text = String::from_utf8_lossy(&result.stdout).to_ascii_lowercase();
            if text.contains("openmd") || text.contains("open.md") || text.contains("gvastethecreator")
            {
                status_base("default", "open.md appears to be the default app for .md.")
            } else if text.contains("progid") {
                status_base(
                    "registered_not_default",
                    "Another app is the default for .md. Use Set as default to open Windows settings.",
                )
            } else {
                status_base(
                    "unknown",
                    "Could not determine the default app for .md. Packaged installs register Open With.",
                )
            }
        }
        _ => status_base(
            "unknown",
            "Packaged installs register .md, .markdown, and .txt for Open With. Use Set as default to open Windows settings.",
        ),
    }
}

#[cfg(target_os = "windows")]
fn windows_request() -> Result<FileAssociationActionResult, String> {
    // Windows blocks silent default changes; open the OS Default apps UI.
    // Use `cmd /C start` so ms-settings: is handled by the shell.
    let status = Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:defaultapps"])
        .status()
        .map_err(|error| format!("Could not open Windows default-app settings: {error}"))?;

    if !status.success() {
        return Err("Could not open Windows Default apps settings.".into());
    }

    Ok(FileAssociationActionResult {
        outcome: "opened_settings",
        detail: "Opened Windows Default apps. Choose open.md for Markdown and text files.".into(),
    })
}

#[cfg(target_os = "macos")]
fn macos_request() -> Result<FileAssociationActionResult, String> {
    // Prefer System Settings when available (Ventura+); fall back to older pane id.
    let modern = Command::new("open")
        .args(["x-apple.systempreferences:com.apple.Preference.Default-Apps"])
        .status();
    if modern.map(|s| s.success()).unwrap_or(false) {
        return Ok(FileAssociationActionResult {
            outcome: "opened_settings",
            detail: "Opened System Settings. Set open.md as the default for Markdown and text."
                .into(),
        });
    }

    let fallback = Command::new("open")
        .args(["-b", "com.apple.systempreferences"])
        .status()
        .map_err(|error| format!("Could not open System Settings: {error}"))?;
    if !fallback.success() {
        return Err("Could not open System Settings for default apps.".into());
    }

    Ok(FileAssociationActionResult {
        outcome: "opened_settings",
        detail:
            "Opened System Settings. Use Get Info → Open with → Change All on a .md file if needed."
                .into(),
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn desktop_file_candidates() -> Vec<&'static str> {
    // Tauri productName is "open.md"; packages may also emit identifier-based names.
    vec![
        "open.md.desktop",
        "open-md.desktop",
        "com.gvastethecreator.openmd.desktop",
    ]
}

#[cfg(all(unix, not(target_os = "macos")))]
fn query_default_desktop(mime: &str) -> Option<String> {
    let output = Command::new("xdg-mime")
        .args(["query", "default", mime])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let desktop = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if desktop.is_empty() {
        None
    } else {
        Some(desktop)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn desktop_looks_like_openmd(desktop: &str) -> bool {
    let lower = desktop.to_ascii_lowercase();
    lower.contains("open.md") || lower.contains("open-md") || lower.contains("openmd")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn linux_status() -> FileAssociationStatus {
    match query_default_desktop("text/markdown") {
        Some(desktop) if desktop_looks_like_openmd(&desktop) => status_base(
            "default",
            format!("Default for text/markdown is {desktop}."),
        ),
        Some(desktop) => status_base(
            "registered_not_default",
            format!("Default for text/markdown is {desktop}. Use Set as default to choose open.md."),
        ),
        None => status_base(
            "unknown",
            "Packaged installs register MIME types. xdg-mime was unavailable or returned no result.",
        ),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn mime_defaults_match(desktop: &str, mime_types: &[&str]) -> bool {
    mime_types.iter().all(|mime| {
        query_default_desktop(mime)
            .map(|current| current.eq_ignore_ascii_case(desktop))
            .unwrap_or(false)
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn try_set_linux_defaults(desktop: &str, mime_types: &[&str]) -> Result<(), String> {
    for mime in mime_types {
        let status = Command::new("xdg-mime")
            .args(["default", desktop, mime])
            .status()
            .map_err(|error| format!("Could not run xdg-mime: {error}"))?;
        if !status.success() {
            return Err(format!("xdg-mime exited with {status} for {desktop}"));
        }
    }
    if !mime_defaults_match(desktop, mime_types) {
        return Err(format!(
            "xdg-mime accepted {desktop} but it is not the active default (desktop entry may be missing)"
        ));
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn linux_request() -> Result<FileAssociationActionResult, String> {
    let mime_types = ["text/markdown", "text/plain"];
    let mut last_error = String::from("xdg-mime is not available");

    for desktop in desktop_file_candidates() {
        match try_set_linux_defaults(desktop, &mime_types) {
            Ok(()) => {
                return Ok(FileAssociationActionResult {
                    outcome: "set_default",
                    detail: format!(
                        "Set {desktop} as the user default for Markdown and plain text."
                    ),
                });
            }
            Err(error) => last_error = error,
        }
    }

    // Fall back to opening a settings UI when present.
    for command in ["xdg-open", "gnome-control-center", "systemsettings5"] {
        let args: &[&str] = match command {
            "xdg-open" => &["applications:"],
            "gnome-control-center" => &["default-applications"],
            "systemsettings5" => &["componentchooser"],
            _ => &[],
        };
        if Command::new(command).args(args).spawn().is_ok() {
            return Ok(FileAssociationActionResult {
                outcome: "opened_settings",
                detail: format!(
                    "Could not set defaults automatically ({last_error}). Opened system application settings."
                ),
            });
        }
    }

    Err(format!(
        "Could not set file associations ({last_error}). Install a packaged build so the .desktop file is available, then use your desktop's Default Applications settings."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_lists_packaged_extensions() {
        let status = get_status();
        assert_eq!(status.extensions, vec!["md", "markdown", "txt"]);
        assert!(!status.platform.is_empty());
        assert!(!status.status.is_empty());
        assert!(!status.detail.is_empty());
    }
}
