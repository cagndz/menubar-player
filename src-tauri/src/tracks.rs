use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::error::AppError;

const FILE_NAME: &str = "sessions.json";
const BACKUP_FILE_NAME: &str = "sessions.json.bak";
const CURRENT_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// YouTube video id.
    pub id: String,
    pub url: String,
    pub title: String,
    /// Seconds; 0 when unknown.
    pub duration: f64,
    /// Seconds.
    pub position: f64,
    pub added_at: String,
    pub last_played_at: String,
}

#[derive(Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    // The name the library was first saved under; kept so existing files still load.
    #[serde(rename = "sessions")]
    tracks: Vec<Track>,
}

pub struct TrackStore {
    path: PathBuf,
    tracks: Mutex<Vec<Track>>,
}

impl TrackStore {
    /// Reads the store from `dir`. An unreadable file is set aside as a backup
    /// and the store starts empty, so a bad file never keeps the app from launching.
    pub fn load(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let tracks = match fs::read_to_string(&path) {
            Ok(contents) => match serde_json::from_str::<StoreFile>(&contents) {
                Ok(file) if file.version == CURRENT_VERSION => file.tracks,
                _ => {
                    let _ = fs::rename(&path, dir.join(BACKUP_FILE_NAME));
                    Vec::new()
                }
            },
            Err(_) => Vec::new(),
        };

        Self {
            path,
            tracks: Mutex::new(tracks),
        }
    }

    /// Oldest addition first; see `sorted`.
    pub fn list(&self) -> Vec<Track> {
        sorted(&self.tracks.lock().unwrap())
    }

    /// Adds the track, or refreshes its metadata and play date if it already
    /// exists. The saved position is never touched here.
    pub fn upsert(
        &self,
        id: String,
        url: String,
        title: String,
        duration: f64,
    ) -> Result<Vec<Track>, AppError> {
        let now = now();
        self.mutate(|tracks| match tracks.iter_mut().find(|s| s.id == id) {
            Some(existing) => {
                existing.url = url;
                existing.title = title;
                existing.duration = duration;
                existing.last_played_at = now;
            }
            None => tracks.push(Track {
                id,
                url,
                title,
                duration,
                position: 0.0,
                added_at: now.clone(),
                last_played_at: now,
            }),
        })
    }

    pub fn set_position(&self, id: &str, position: f64) -> Result<(), AppError> {
        let position = if position.is_finite() {
            position.max(0.0)
        } else {
            0.0
        };
        self.mutate(|tracks| {
            if let Some(track) = tracks.iter_mut().find(|s| s.id == id) {
                track.position = position;
            }
        })
        .map(|_| ())
    }

    pub fn delete(&self, id: &str) -> Result<Vec<Track>, AppError> {
        self.mutate(|tracks| tracks.retain(|s| s.id != id))
    }

    /// Puts back a track exactly as it was before being deleted.
    pub fn restore(&self, track: Track) -> Result<Vec<Track>, AppError> {
        self.mutate(|tracks| {
            tracks.retain(|s| s.id != track.id);
            tracks.push(track);
        })
    }

    fn mutate(&self, change: impl FnOnce(&mut Vec<Track>)) -> Result<Vec<Track>, AppError> {
        let mut tracks = self.tracks.lock().unwrap();
        change(&mut tracks);
        self.write(&tracks)?;
        Ok(sorted(&tracks))
    }

    /// Writes to a temporary file and renames it, so a crash mid-write can't
    /// leave a truncated store behind.
    fn write(&self, tracks: &[Track]) -> Result<(), AppError> {
        let storage_error = |e: std::io::Error| AppError::with_detail("storage_failed", e);

        let file = StoreFile {
            version: CURRENT_VERSION,
            tracks: tracks.to_vec(),
        };
        let json = serde_json::to_string_pretty(&file)
            .map_err(|e| AppError::with_detail("storage_failed", e))?;

        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(storage_error)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, json).map_err(storage_error)?;
        fs::rename(&temporary, &self.path).map_err(storage_error)
    }
}

/// Library order: oldest addition first, so a new track goes to the end. It
/// depends only on when a track was added (ties broken by id), so playing,
/// refreshing or restoring a track never moves it.
fn sorted(tracks: &[Track]) -> Vec<Track> {
    let mut sorted = tracks.to_vec();
    // RFC 3339 UTC timestamps with whole seconds sort chronologically as text.
    sorted.sort_by(|a, b| a.added_at.cmp(&b.added_at).then_with(|| a.id.cmp(&b.id)));
    sorted
}

fn now() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .ok()
        .and_then(|time| time.format(&Rfc3339).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("menubar-player-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn add(store: &TrackStore, id: &str) -> Vec<Track> {
        store
            .upsert(
                id.into(),
                format!("https://www.youtube.com/watch?v={id}"),
                id.into(),
                100.0,
            )
            .unwrap()
    }

    #[test]
    fn persists_across_loads() {
        let dir = temp_dir("persist");
        let store = TrackStore::load(&dir);
        add(&store, "a");
        store.set_position("a", 42.5).unwrap();

        let reloaded = TrackStore::load(&dir).list();
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].position, 42.5);
    }

    #[test]
    fn upsert_keeps_position_and_does_not_duplicate() {
        let dir = temp_dir("upsert");
        let store = TrackStore::load(&dir);
        add(&store, "a");
        store.set_position("a", 30.0).unwrap();

        let tracks = store
            .upsert("a".into(), "url".into(), "New title".into(), 200.0)
            .unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].position, 30.0);
        assert_eq!(tracks[0].title, "New title");
        assert_eq!(tracks[0].duration, 200.0);
    }

    #[test]
    fn delete_then_restore_brings_back_the_same_track() {
        let dir = temp_dir("restore");
        let store = TrackStore::load(&dir);
        add(&store, "a");
        store.set_position("a", 12.0).unwrap();
        let original = store.list()[0].clone();

        assert!(store.delete("a").unwrap().is_empty());
        assert_eq!(store.restore(original.clone()).unwrap(), vec![original]);
        assert_eq!(TrackStore::load(&dir).list().len(), 1);
    }

    fn ids(tracks: &[Track]) -> Vec<&str> {
        tracks.iter().map(|s| s.id.as_str()).collect()
    }

    /// Three tracks added a day apart, oldest first.
    fn store_with_three(name: &str) -> TrackStore {
        let dir = temp_dir(name);
        let store = TrackStore::load(&dir);
        for (id, day) in [("a", "01"), ("b", "02"), ("c", "03")] {
            add(&store, id);
            let mut track = store.list().into_iter().find(|s| s.id == id).unwrap();
            track.added_at = format!("2026-10-{day}T10:00:00Z");
            track.last_played_at = track.added_at.clone();
            store.restore(track).unwrap();
        }
        store
    }

    #[test]
    fn lists_newest_addition_last() {
        let store = store_with_three("order");
        assert_eq!(ids(&store.list()), ["a", "b", "c"]);
    }

    #[test]
    fn playing_or_refreshing_a_track_does_not_move_it() {
        let store = store_with_three("order-upsert");

        // Playing a track is an upsert of an existing one plus position updates.
        let after_upsert = store
            .upsert("a".into(), "url".into(), "a".into(), 100.0)
            .unwrap();
        assert_eq!(ids(&after_upsert), ["a", "b", "c"]);
        store.set_position("a", 55.0).unwrap();
        assert_eq!(ids(&store.list()), ["a", "b", "c"]);

        // It still records when it was last played.
        let played = store.list().into_iter().find(|s| s.id == "a").unwrap();
        assert_ne!(played.last_played_at, played.added_at);
    }

    #[test]
    fn undoing_a_removal_puts_the_track_back_where_it_was() {
        let store = store_with_three("order-undo");
        let middle = store.list()[1].clone();

        assert_eq!(ids(&store.delete("b").unwrap()), ["a", "c"]);
        assert_eq!(ids(&store.restore(middle).unwrap()), ["a", "b", "c"]);
    }

    #[test]
    fn tracks_added_in_the_same_second_keep_a_fixed_order() {
        let dir = temp_dir("order-ties");
        let store = TrackStore::load(&dir);
        add(&store, "y");
        add(&store, "x");
        let before = ids(&store.list()).join(",");

        store
            .upsert("y".into(), "url".into(), "y".into(), 100.0)
            .unwrap();
        let removed = store.list().into_iter().find(|s| s.id == "x").unwrap();
        store.delete("x").unwrap();
        store.restore(removed).unwrap();

        assert_eq!(ids(&store.list()).join(","), before);
    }

    #[test]
    fn the_file_keeps_the_key_it_was_first_saved_under() {
        let dir = temp_dir("file-key");
        add(&TrackStore::load(&dir), "a");

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(FILE_NAME)).unwrap()).unwrap();
        assert_eq!(saved["sessions"][0]["id"], "a");
    }

    #[test]
    fn corrupt_file_is_backed_up_and_store_starts_empty() {
        let dir = temp_dir("corrupt");
        fs::write(dir.join(FILE_NAME), "{ not json").unwrap();

        let store = TrackStore::load(&dir);
        assert!(store.list().is_empty());
        assert_eq!(
            fs::read_to_string(dir.join(BACKUP_FILE_NAME)).unwrap(),
            "{ not json"
        );

        add(&store, "a");
        assert_eq!(TrackStore::load(&dir).list().len(), 1);
    }
}
