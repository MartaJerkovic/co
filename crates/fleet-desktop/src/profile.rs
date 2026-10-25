//! Which app this binary is. With no profile it is Fleet.app; a profile
//! (`Contents/Resources/profile.json`, written by `bundle.sh --profile …`) turns the
//! same shell into a plain window on another web app: its own name and bundle
//! identifier, a fixed remote URL, the native title bar, and none of Fleet's extras
//! (local server, `fleet://` links, menu commands, the drag grant, the page script).

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Points at a profile file instead of the bundle's (for `cargo run`).
pub const PROFILE_ENV: &str = "FLEET_DESKTOP_PROFILE";

/// A web app other than Fleet, at a remote URL.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Remote {
    /// The app's name: menu, window title, start page.
    pub name: String,
    /// Tauri's identifier: keeps single-instance, window state and the app's
    /// config dir apart from Fleet.app's (Info.plist carries the same one).
    pub identifier: String,
    /// The URL baked in at bundle time.
    #[serde(default)]
    pub url: Option<String>,
    /// An env var that overrides `url` (e.g. `FIN_DESKTOP_URL`).
    #[serde(default)]
    pub url_env: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Profile {
    Fleet,
    Remote(Remote),
}

impl Profile {
    pub fn name(&self) -> &str {
        match self {
            Profile::Fleet => "Fleet",
            Profile::Remote(r) => &r.name,
        }
    }

    pub fn is_fleet(&self) -> bool {
        matches!(self, Profile::Fleet)
    }
}

/// `$FLEET_DESKTOP_PROFILE`, else `profile.json` in the bundle's Resources, else Fleet.
pub fn load() -> Result<Profile, String> {
    if let Some(p) = std::env::var_os(PROFILE_ENV).filter(|p| !p.is_empty()) {
        return read(Path::new(&p));
    }
    match bundled() {
        Some(p) if p.exists() => read(&p),
        _ => Ok(Profile::Fleet),
    }
}

/// `<App>.app/Contents/Resources/profile.json`, next to `Contents/MacOS/<exe>`.
fn bundled() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.parent()?.join("Resources/profile.json"))
}

pub fn read(path: &Path) -> Result<Profile, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    parse(&text).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn parse(text: &str) -> Result<Profile, String> {
    let r: Remote = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if r.name.trim().is_empty() || r.identifier.trim().is_empty() {
        return Err("name and identifier must not be empty".into());
    }
    Ok(Profile::Remote(r))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_remote_profile() {
        let p = parse(
            r#"{ "name": "Example", "identifier": "dev.example.app",
                 "url": "https://app.example.com:4443", "urlEnv": "EXAMPLE_URL" }"#,
        )
        .unwrap();
        assert_eq!(p.name(), "Example");
        assert!(!p.is_fleet());
        let Profile::Remote(r) = p else { panic!() };
        assert_eq!(r.url.as_deref(), Some("https://app.example.com:4443"));
        assert_eq!(r.url_env.as_deref(), Some("EXAMPLE_URL"));
    }

    #[test]
    fn rejects_bad_profiles() {
        assert!(parse(r#"{ "name": "", "identifier": "x" }"#).is_err());
        assert!(parse(r#"{ "name": "X" }"#).is_err());
        assert!(parse(r#"{ "name": "X", "identifier": "x", "localServer": true }"#).is_err());
        assert!(parse("not json").is_err());
    }

    #[test]
    fn no_profile_is_fleet() {
        assert_eq!(Profile::Fleet.name(), "Fleet");
        assert!(Profile::Fleet.is_fleet());
        let dir = tempfile::tempdir().unwrap();
        assert!(read(&dir.path().join("missing.json")).is_err());
    }
}
