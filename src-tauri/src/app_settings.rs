use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Stable app config directory name (matches Tauri identifier / appConfigDir).
const APP_CONFIG_DIR: &str = "com.gvastethecreator.openmd";
const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// When true (default), each OS launch may start a new process.
    /// When false, the single-instance plugin reuses the running process.
    #[serde(default = "default_allow_multiple_instances")]
    pub allow_multiple_instances: bool,
}

fn default_allow_multiple_instances() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            allow_multiple_instances: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAllowMultipleInstancesResult {
    pub allow_multiple_instances: bool,
    /// Current process keeps its boot mode; disk value applies on next launch.
    pub applied: &'static str,
}

pub fn config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|root| PathBuf::from(root).join(APP_CONFIG_DIR))
    }

    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(APP_CONFIG_DIR)
        })
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
            return Some(PathBuf::from(xdg).join(APP_CONFIG_DIR));
        }
        std::env::var_os("HOME")
            .map(|home| PathBuf::from(home).join(".config").join(APP_CONFIG_DIR))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        None
    }
}

pub fn settings_path() -> Option<PathBuf> {
    config_dir().map(|dir| dir.join(SETTINGS_FILE))
}

pub fn load() -> AppSettings {
    let Some(path) = settings_path() else {
        return AppSettings::default();
    };
    load_from_path(&path)
}

pub fn load_from_path(path: &Path) -> AppSettings {
    let Ok(raw) = fs::read_to_string(path) else {
        return AppSettings::default();
    };
    parse_settings(&raw)
}

pub fn parse_settings(raw: &str) -> AppSettings {
    match serde_json::from_str::<AppSettings>(raw) {
        Ok(settings) => settings,
        Err(_) => AppSettings::default(),
    }
}

pub fn save(settings: &AppSettings) -> Result<(), String> {
    let path =
        settings_path().ok_or_else(|| "Could not resolve app config directory".to_string())?;
    save_to_path(&path, settings)
}

/// Persist settings with a same-directory temp file + replace to avoid torn JSON.
pub fn save_to_path(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &raw).map_err(|error| error.to_string())?;
    replace_file(&tmp, path).map_err(|error| {
        let _ = fs::remove_file(&tmp);
        error
    })?;
    Ok(())
}

fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    // Windows rename fails when the destination exists; remove first.
    if to.exists() {
        fs::remove_file(to).map_err(|error| error.to_string())?;
    }
    fs::rename(from, to).map_err(|error| error.to_string())
}

pub fn set_allow_multiple_instances(
    value: bool,
) -> Result<SetAllowMultipleInstancesResult, String> {
    let mut settings = load();
    settings.allow_multiple_instances = value;
    save(&settings)?;
    Ok(SetAllowMultipleInstancesResult {
        allow_multiple_instances: value,
        applied: "next_launch",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_settings_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("openmd-settings-{label}-{nanos}.json"))
    }

    #[test]
    fn defaults_allow_multiple_instances() {
        assert!(AppSettings::default().allow_multiple_instances);
        assert!(parse_settings("{}").allow_multiple_instances);
        assert!(parse_settings("not-json").allow_multiple_instances);
        assert!(
            load_from_path(Path::new("/no/such/openmd-settings.json")).allow_multiple_instances
        );
    }

    #[test]
    fn parses_explicit_false() {
        let settings = parse_settings(r#"{"allowMultipleInstances":false}"#);
        assert!(!settings.allow_multiple_instances);
    }

    #[test]
    fn round_trips_settings_file() {
        let path = temp_settings_path("roundtrip");
        let settings = AppSettings {
            allow_multiple_instances: false,
        };
        save_to_path(&path, &settings).expect("write");
        let loaded = load_from_path(&path);
        assert_eq!(loaded, settings);
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn overwrite_existing_settings_atomically() {
        let path = temp_settings_path("overwrite");
        save_to_path(
            &path,
            &AppSettings {
                allow_multiple_instances: true,
            },
        )
        .expect("first write");
        save_to_path(
            &path,
            &AppSettings {
                allow_multiple_instances: false,
            },
        )
        .expect("second write");
        assert!(!load_from_path(&path).allow_multiple_instances);
        let _ = fs::remove_file(&path);
    }
}
