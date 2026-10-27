//! When a Claude session last finished a turn: the timestamp of the last
//! `{"type":"system","subtype":"turn_duration"}` entry, which Claude Code writes
//! at the end of every turn, read from the tail of the transcript. A slash
//! command (`/rename`, `/model`) writes none.
//!
//! **Cost.** Only the last 256 KiB are read, cached per `(path, size, mtime)`.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

const TAIL: u64 = 256 * 1024;

type CacheKey = (u64, Option<SystemTime>);
type Cache = HashMap<PathBuf, (CacheKey, Option<i64>)>;
static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Ms since epoch of the session's last finished turn; `None` before its first.
pub fn ended_at(home: &Path, cwd: Option<&str>, session_id: &str) -> Option<i64> {
    let path = crate::core::context::locate_transcript(home, cwd, session_id)?;
    let meta = std::fs::metadata(&path).ok()?;
    let key: CacheKey = (meta.len(), meta.modified().ok());
    if let Some(hit) = CACHE
        .lock()
        .ok()
        .and_then(|c| c.get(&path).filter(|(k, _)| *k == key).map(|(_, v)| *v))
    {
        return hit;
    }
    let found = read_tail(&path, meta.len()).and_then(|t| last_turn_end(&t));
    if let Ok(mut c) = CACHE.lock() {
        c.insert(path, (key, found));
    }
    found
}

fn read_tail(path: &Path, size: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let start = size.saturating_sub(TAIL);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    file.take(size - start).read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    Some(if start > 0 {
        text.split_once('\n')
            .map_or(String::new(), |(_, rest)| rest.to_string())
    } else {
        text
    })
}

fn last_turn_end(text: &str) -> Option<i64> {
    text.lines()
        .rev()
        .filter(|l| l.contains("\"turn_duration\""))
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .find(|v| {
            v["type"] == "system" && v["subtype"] == "turn_duration" && v["isSidechain"] != true
        })
        .and_then(|v| v["timestamp"].as_str().map(str::to_string))
        .and_then(|t| chrono::DateTime::parse_from_rfc3339(&t).ok())
        .map(|t| t.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_main_thread_turn_end_counts() {
        let text = [
            r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-10-26T12:52:29.586Z"}"#,
            r#"{"type":"user","timestamp":"2026-10-26T12:53:42.599Z","message":{"content":"Say yes."}}"#,
            r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-10-26T12:53:43.927Z"}"#,
            r#"{"type":"system","subtype":"turn_duration","isSidechain":true,"timestamp":"2026-10-26T12:54:00.000Z"}"#,
            r#"{"type":"last-prompt"}"#,
        ]
        .join("\n");
        assert_eq!(last_turn_end(&text), Some(1_793_019_223_927));
    }

    #[test]
    fn no_finished_turn_is_none() {
        assert_eq!(
            last_turn_end(r#"{"type":"user","message":{"content":"hi"}}"#),
            None
        );
    }

    #[test]
    fn a_transcript_is_read_from_its_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        let pad = format!("{{\"type\":\"user\",\"pad\":\"{}\"}}\n", "x".repeat(1000)).repeat(400);
        let end =
            r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-10-26T12:53:43.927Z"}"#;
        std::fs::write(&path, format!("{pad}{end}\n")).unwrap();
        let size = std::fs::metadata(&path).unwrap().len();
        assert!(size > TAIL);
        assert_eq!(
            read_tail(&path, size).and_then(|t| last_turn_end(&t)),
            Some(1_793_019_223_927)
        );
    }
}
