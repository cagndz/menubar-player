use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const FILE_NAME: &str = "rate_limit.json";
pub const RATE_LIMIT_CODE: &str = "rate_limited";

/// How long to stay away from YouTube after each consecutive rate limit: the
/// first one costs 10 minutes, the second 30, and from the third on an hour.
const BACKOFF_SECONDS: [u64; 3] = [10 * 60, 30 * 60, 60 * 60];

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Block {
    /// Unix time (seconds) until which no resolution is attempted; 0 when there is no block.
    blocked_until: u64,
    /// Consecutive rate limits so far; decides the length of the next block.
    level: u32,
}

/// Keeps the app from asking YouTube again while it is limiting requests.
/// Every resolution goes through `guard`. The block is kept on disk, so
/// quitting and reopening the app doesn't skip the wait.
pub struct RateLimiter {
    path: PathBuf,
    block: Mutex<Block>,
}

impl RateLimiter {
    /// A missing or unreadable file simply means there is no block.
    pub fn load(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        let block = fs::read_to_string(&path)
            .ok()
            .and_then(|contents| serde_json::from_str(&contents).ok())
            .unwrap_or_default();
        Self {
            path,
            block: Mutex::new(block),
        }
    }

    /// Runs `resolve` unless a block is in force, in which case it answers
    /// with the rate limit error without calling it. A rate-limited result
    /// starts the next, longer block; a successful one clears the history.
    pub fn guard<T>(
        &self,
        now: u64,
        resolve: impl FnOnce() -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let blocked_until = self.block.lock().unwrap().blocked_until;
        if now < blocked_until {
            return Err(AppError::with_detail(
                RATE_LIMIT_CODE,
                format!(
                    "cooling down for another {} s; yt-dlp was not called",
                    blocked_until - now
                ),
            ));
        }

        let result = resolve();
        match &result {
            Err(error) if error.code == RATE_LIMIT_CODE => self.update(|block| {
                let step = (block.level as usize).min(BACKOFF_SECONDS.len() - 1);
                block.blocked_until = now + BACKOFF_SECONDS[step];
                block.level = block.level.saturating_add(1);
            }),
            Ok(_) => self.update(|block| *block = Block::default()),
            // Any other failure says nothing about the limit either way.
            Err(_) => {}
        }
        result
    }

    fn update(&self, change: impl FnOnce(&mut Block)) {
        let mut block = self.block.lock().unwrap();
        let before = *block;
        change(&mut block);
        if *block != before {
            // Best effort: failing to write only means the block won't survive a restart.
            let _ = self.write(&block);
        }
    }

    /// Same atomic write as the library: a temporary file, then a rename.
    fn write(&self, block: &Block) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_string(block).unwrap_or_default())?;
        fs::rename(&temporary, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const START: u64 = 1_800_000_000;
    const MINUTE: u64 = 60;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "menubar-player-limit-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn limited() -> Result<&'static str, AppError> {
        Err(AppError::new(RATE_LIMIT_CODE))
    }

    fn is_limited<T>(result: &Result<T, AppError>) -> bool {
        matches!(result, Err(error) if error.code == RATE_LIMIT_CODE)
    }

    /// Calls `guard` with a resolver that must not run.
    fn blocked(limiter: &RateLimiter, now: u64) -> bool {
        let called = Cell::new(false);
        let result = limiter.guard(now, || {
            called.set(true);
            Ok("stream")
        });
        assert!(!called.get() || result.is_ok());
        is_limited(&result) && !called.get()
    }

    #[test]
    fn passes_resolutions_through_while_nothing_is_wrong() {
        let limiter = RateLimiter::load(&temp_dir("ok"));
        assert_eq!(limiter.guard(START, || Ok("stream")).unwrap(), "stream");
        assert!(!blocked(&limiter, START + 1));
    }

    #[test]
    fn does_not_call_the_resolver_during_the_cooldown() {
        let limiter = RateLimiter::load(&temp_dir("cooldown"));
        assert!(is_limited(&limiter.guard(START, limited)));

        for elapsed in [0, MINUTE, 10 * MINUTE - 1] {
            assert!(
                blocked(&limiter, START + elapsed),
                "should be blocked after {elapsed} s"
            );
        }
        assert!(!blocked(&limiter, START + 10 * MINUTE));
    }

    #[test]
    fn backs_off_10_minutes_then_30_then_an_hour_and_stays_there() {
        let limiter = RateLimiter::load(&temp_dir("backoff"));
        let mut now = START;

        for minutes in [10, 30, 60, 60, 60] {
            assert!(is_limited(&limiter.guard(now, limited)));
            assert!(
                blocked(&limiter, now + minutes * MINUTE - 1),
                "{minutes} min block ended early"
            );
            now += minutes * MINUTE;
            // The block is over: the next call reaches the resolver again.
        }
    }

    #[test]
    fn starts_over_after_the_first_success() {
        let limiter = RateLimiter::load(&temp_dir("reset"));
        assert!(is_limited(&limiter.guard(START, limited)));
        assert!(is_limited(&limiter.guard(START + 10 * MINUTE, limited)));

        // After the 30 minute block a resolution works: the history is cleared.
        let after = START + 40 * MINUTE;
        assert!(limiter.guard(after, || Ok("stream")).is_ok());

        assert!(is_limited(&limiter.guard(after + 1, limited)));
        assert!(blocked(&limiter, after + 10 * MINUTE));
        assert!(!blocked(&limiter, after + 1 + 10 * MINUTE));
    }

    #[test]
    fn other_failures_neither_block_nor_clear_the_history() {
        let limiter = RateLimiter::load(&temp_dir("other"));
        let failed = || -> Result<&'static str, AppError> { Err(AppError::new("ytdlp_failed")) };

        assert!(!is_limited(&limiter.guard(START, failed)));
        assert!(!blocked(&limiter, START + 1));

        assert!(is_limited(&limiter.guard(START + 2, limited)));
        let after_block = START + 2 + 10 * MINUTE;
        assert!(!is_limited(&limiter.guard(after_block, failed)));
        // Still on the second step: the failure in between didn't reset it.
        assert!(is_limited(&limiter.guard(after_block + 1, limited)));
        assert!(blocked(&limiter, after_block + 1 + 30 * MINUTE - 1));
    }

    #[test]
    fn the_block_and_its_level_survive_a_restart() {
        let dir = temp_dir("persist");
        let limiter = RateLimiter::load(&dir);
        assert!(is_limited(&limiter.guard(START, limited)));
        assert!(is_limited(&limiter.guard(START + 10 * MINUTE, limited)));
        drop(limiter);

        let reopened = RateLimiter::load(&dir);
        assert!(blocked(&reopened, START + 10 * MINUTE + 29 * MINUTE));
        assert!(!dir.join("rate_limit.json.tmp").exists());

        // And the level too: the next limit costs the full hour.
        let after = START + 40 * MINUTE;
        assert!(is_limited(&reopened.guard(after, limited)));
        assert!(blocked(&reopened, after + 60 * MINUTE - 1));
    }

    #[test]
    fn a_success_clears_the_file_as_well() {
        let dir = temp_dir("clear");
        let limiter = RateLimiter::load(&dir);
        assert!(is_limited(&limiter.guard(START, limited)));
        assert!(limiter.guard(START + 10 * MINUTE, || Ok("stream")).is_ok());

        assert!(!blocked(&RateLimiter::load(&dir), START + 10 * MINUTE + 1));
    }

    #[test]
    fn a_missing_or_corrupt_file_means_no_block() {
        let dir = temp_dir("corrupt");
        assert!(!blocked(&RateLimiter::load(&dir), START));

        for contents in ["{ not json", "", "[]", "{\"blockedUntil\":\"soon\"}"] {
            fs::write(dir.join(FILE_NAME), contents).unwrap();
            let limiter = RateLimiter::load(&dir);
            assert!(!blocked(&limiter, START), "blocked by {contents:?}");
            // And it works normally from there, replacing the bad file.
            assert!(is_limited(&limiter.guard(START, limited)));
            assert!(blocked(&RateLimiter::load(&dir), START + 1));
        }
    }
}
