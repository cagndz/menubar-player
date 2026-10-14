use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::error::AppError;

const FILE_NAME: &str = "sessions.json";
const CURRENT_VERSION: u32 = 1;
/// Set when the library on disk was written by a newer version of the app.
const LIBRARY_NEWER: &str = "library_newer";

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
    /// The file belongs to a newer version of the app: it is neither read nor
    /// written, so this version can never empty a library it doesn't understand.
    newer_file: bool,
}

/// What a library file turned out to hold.
enum Contents {
    Tracks(Vec<Track>),
    /// Written by a newer version of the app, in a format this one may not know.
    Newer,
    Unreadable,
}

fn parse(contents: &str) -> Contents {
    // The version is read first, on its own: a newer file may not have the
    // shape this version expects at all.
    let Ok(value) = serde_json::from_str::<serde_json::Value>(contents) else {
        return Contents::Unreadable;
    };
    if value.get("version").and_then(serde_json::Value::as_u64) > Some(u64::from(CURRENT_VERSION)) {
        return Contents::Newer;
    }
    match serde_json::from_value::<StoreFile>(value) {
        Ok(file) if file.version == CURRENT_VERSION => Contents::Tracks(file.tracks),
        _ => Contents::Unreadable,
    }
}

/// `sessions.json.<UTC timestamp>.bak`, numbered if one from the same second exists.
fn backup_path(dir: &Path) -> PathBuf {
    let format = time::macros::format_description!("[year][month][day]T[hour][minute][second]Z");
    let stamp = OffsetDateTime::now_utc()
        .format(&format)
        .unwrap_or_default();
    let mut candidate = dir.join(format!("{FILE_NAME}.{stamp}.bak"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{FILE_NAME}.{stamp}-{n}.bak"));
        n += 1;
    }
    candidate
}

impl TrackStore {
    /// Reads the store from `dir`. An unreadable file is set aside as a dated
    /// backup (earlier backups are kept) and the store starts empty, so a bad
    /// file never keeps the app from launching. A file from a newer version is
    /// left exactly as it is, and nothing can be saved over it.
    pub fn load(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let contents = match fs::read_to_string(&path) {
            Ok(text) => parse(&text),
            Err(_) => Contents::Tracks(Vec::new()),
        };
        let (tracks, newer_file) = match contents {
            Contents::Tracks(tracks) => (tracks, false),
            Contents::Newer => (Vec::new(), true),
            Contents::Unreadable => {
                let _ = fs::rename(&path, backup_path(dir));
                (Vec::new(), false)
            }
        };

        Self {
            path,
            tracks: Mutex::new(tracks),
            newer_file,
        }
    }

    /// Oldest addition first; see `sorted`.
    /// Fails while the file on disk belongs to a newer version, so the app
    /// says why the library is empty instead of just showing it empty.
    pub fn list(&self) -> Result<Vec<Track>, AppError> {
        if self.newer_file {
            return Err(AppError::new(LIBRARY_NEWER));
        }
        Ok(sorted(&self.tracks.lock().unwrap()))
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
        if self.newer_file {
            return Err(AppError::new(LIBRARY_NEWER));
        }
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

        let reloaded = TrackStore::load(&dir).list().unwrap();
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
        let original = store.list().unwrap()[0].clone();

        assert!(store.delete("a").unwrap().is_empty());
        assert_eq!(store.restore(original.clone()).unwrap(), vec![original]);
        assert_eq!(TrackStore::load(&dir).list().unwrap().len(), 1);
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
            let mut track = store
                .list()
                .unwrap()
                .into_iter()
                .find(|s| s.id == id)
                .unwrap();
            track.added_at = format!("2026-10-{day}T10:00:00Z");
            track.last_played_at = track.added_at.clone();
            store.restore(track).unwrap();
        }
        store
    }

    #[test]
    fn lists_newest_addition_last() {
        let store = store_with_three("order");
        assert_eq!(ids(&store.list().unwrap()), ["a", "b", "c"]);
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
        assert_eq!(ids(&store.list().unwrap()), ["a", "b", "c"]);

        // It still records when it was last played.
        let played = store
            .list()
            .unwrap()
            .into_iter()
            .find(|s| s.id == "a")
            .unwrap();
        assert_ne!(played.last_played_at, played.added_at);
    }

    #[test]
    fn undoing_a_removal_puts_the_track_back_where_it_was() {
        let store = store_with_three("order-undo");
        let middle = store.list().unwrap()[1].clone();

        assert_eq!(ids(&store.delete("b").unwrap()), ["a", "c"]);
        assert_eq!(ids(&store.restore(middle).unwrap()), ["a", "b", "c"]);
    }

    #[test]
    fn tracks_added_in_the_same_second_keep_a_fixed_order() {
        let dir = temp_dir("order-ties");
        let store = TrackStore::load(&dir);
        add(&store, "y");
        add(&store, "x");
        let before = ids(&store.list().unwrap()).join(",");

        store
            .upsert("y".into(), "url".into(), "y".into(), 100.0)
            .unwrap();
        let removed = store
            .list()
            .unwrap()
            .into_iter()
            .find(|s| s.id == "x")
            .unwrap();
        store.delete("x").unwrap();
        store.restore(removed).unwrap();

        assert_eq!(ids(&store.list().unwrap()).join(","), before);
    }

    #[test]
    fn the_file_keeps_the_key_it_was_first_saved_under() {
        let dir = temp_dir("file-key");
        add(&TrackStore::load(&dir), "a");

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(FILE_NAME)).unwrap()).unwrap();
        assert_eq!(saved["sessions"][0]["id"], "a");
    }

    fn backups(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|name| name.starts_with("sessions.json.") && name.ends_with(".bak"))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn corrupt_file_is_backed_up_and_store_starts_empty() {
        let dir = temp_dir("corrupt");
        fs::write(dir.join(FILE_NAME), "{ not json").unwrap();

        let store = TrackStore::load(&dir);
        assert!(store.list().unwrap().is_empty());
        let saved = backups(&dir);
        assert_eq!(saved.len(), 1);
        assert_eq!(
            fs::read_to_string(dir.join(&saved[0])).unwrap(),
            "{ not json"
        );

        add(&store, "a");
        assert_eq!(TrackStore::load(&dir).list().unwrap().len(), 1);
    }

    #[test]
    fn each_corrupt_file_gets_its_own_backup() {
        let dir = temp_dir("corrupt-twice");
        fs::write(dir.join(FILE_NAME), "first").unwrap();
        TrackStore::load(&dir);
        fs::write(dir.join(FILE_NAME), "second").unwrap();
        TrackStore::load(&dir);

        let saved = backups(&dir);
        assert_eq!(saved.len(), 2);
        let mut contents: Vec<String> = saved
            .iter()
            .map(|name| fs::read_to_string(dir.join(name)).unwrap())
            .collect();
        contents.sort();
        assert_eq!(contents, ["first", "second"]);
    }

    #[test]
    fn a_library_from_a_newer_version_is_never_moved_or_overwritten() {
        let dir = temp_dir("newer");
        let newer = r#"{ "version": 2, "library": { "anything": ["it may have changed"] } }"#;
        fs::write(dir.join(FILE_NAME), newer).unwrap();

        let store = TrackStore::load(&dir);
        assert_eq!(store.list().unwrap_err().code, "library_newer");
        let refused = store
            .upsert(
                "a".into(),
                "https://www.youtube.com/watch?v=a".into(),
                "a".into(),
                100.0,
            )
            .unwrap_err();
        assert_eq!(refused.code, "library_newer");
        assert_eq!(
            store.set_position("a", 10.0).unwrap_err().code,
            "library_newer"
        );

        assert_eq!(fs::read_to_string(dir.join(FILE_NAME)).unwrap(), newer);
        assert!(backups(&dir).is_empty());
    }
}
