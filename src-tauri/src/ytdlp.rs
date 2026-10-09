use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

// HLS only: the webview plays it natively, with correct duration and seeking.
// YouTube's other audio formats are fragmented DASH, which <audio> fails to load.
const FORMAT: &str = "234/233";
const HLS_PROTOCOL_PREFIX: &str = "m3u8";

const PRINT_TEMPLATE: &str = "%(.{id,title,duration,protocol,webpage_url,url})j";
const YTDLP_FORMAT_UNAVAILABLE: &str = "Requested format is not available";
// What yt-dlp prints when YouTube has seen too many requests from this address.
// The apostrophes are left out on purpose: yt-dlp prints them either straight or curly.
// The bot check is matched by its ending, because an age-restricted video starts the
// same way ("Sign in to confirm your age") and has nothing to do with the request rate.
const RATE_LIMIT_MARKERS: [&str; 4] = [
    "re not a bot",
    "HTTP Error 429",
    "Too Many Requests",
    "t available, try again later",
];

// A resolution takes a few seconds. Past this yt-dlp is stuck, and is killed
// so that it neither piles up nor leaves whoever asked waiting forever.
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(30);
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(50);

const CONNECTIVITY_HOST: &str = "www.youtube.com";
const CONNECTIVITY_TIMEOUT: Duration = Duration::from_secs(3);

// Apps launched from Finder don't inherit the shell PATH, so Homebrew's bin
// directories have to be looked up explicitly.
const EXTRA_BIN_DIRS: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

const ALLOWED_HOSTS: [&str; 5] = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAudio {
    pub id: String,
    pub title: String,
    /// Seconds; 0 when yt-dlp doesn't know it (live streams).
    pub duration: f64,
    /// Canonical watch URL, without the tracking or timestamp parameters of the pasted one.
    pub page_url: String,
    /// Short-lived direct URL of the HLS playlist.
    pub stream_url: String,
    /// Unix time (seconds) at which `stream_url` stops working, when the URL says so.
    pub expires_at: Option<u64>,
}

#[derive(Deserialize)]
struct YtdlpInfo {
    id: String,
    title: Option<String>,
    duration: Option<f64>,
    protocol: Option<String>,
    webpage_url: Option<String>,
    url: Option<String>,
}

pub fn resolve(url: &str) -> Result<ResolvedAudio, AppError> {
    let url = url.trim();
    validate_youtube_url(url)?;

    let binary = find_binary().ok_or_else(|| AppError::new("ytdlp_missing"))?;

    let mut command = Command::new(&binary);
    command
        .env("PATH", child_path())
        .args(["-f", FORMAT])
        .args(["--no-playlist", "--no-warnings", "--socket-timeout", "15"])
        .args(["--print", PRINT_TEMPLATE])
        .arg("--")
        .arg(url);
    let output = run_with_timeout(command, RESOLVE_TIMEOUT)
        .map_err(|e| AppError::with_detail("ytdlp_failed", e))?
        .ok_or_else(|| {
            AppError::with_detail(
                "ytdlp_failed",
                format!("timed out after {} s", RESOLVE_TIMEOUT.as_secs()),
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::with_detail(
            classify_failure(&stderr),
            stderr.trim(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let info: YtdlpInfo = stdout
        .lines()
        .find_map(|line| serde_json::from_str(line).ok())
        .ok_or_else(|| {
            AppError::with_detail("ytdlp_failed", format!("unexpected output: {stdout}"))
        })?;

    let is_hls = info
        .protocol
        .as_deref()
        .is_some_and(|protocol| protocol.starts_with(HLS_PROTOCOL_PREFIX));
    let Some(stream_url) = info.url.filter(|_| is_hls) else {
        return Err(AppError::with_detail(
            "no_playable_format",
            format!("protocol: {:?}", info.protocol),
        ));
    };

    Ok(ResolvedAudio {
        title: info.title.unwrap_or_else(|| info.id.clone()),
        duration: info.duration.unwrap_or(0.0),
        page_url: info.webpage_url.unwrap_or_else(|| url.to_string()),
        expires_at: parse_expiry(&stream_url),
        stream_url,
        id: info.id,
    })
}

/// Runs the command to its end, or kills it once the timeout passes and
/// returns `None`. The command gets a process group of its own, so the
/// helpers it started die with it instead of holding its pipes open.
fn run_with_timeout(mut command: Command, timeout: Duration) -> std::io::Result<Option<Output>> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()?;

    // Both pipes are drained as the command runs: a full pipe would block it.
    fn drain(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut bytes);
            }
            bytes
        })
    }
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());

    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if Instant::now() >= deadline {
            // The negative id addresses the whole group, of which the child is the leader.
            unsafe { libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL) };
            child.wait()?;
            break None;
        }
        std::thread::sleep(EXIT_POLL_INTERVAL);
    };

    let stdout = stdout.join().unwrap_or_default();
    let stderr = stderr.join().unwrap_or_default();
    Ok(status.map(|status| Output {
        status,
        stdout,
        stderr,
    }))
}

/// Error code for a failed yt-dlp run, from what it printed.
fn classify_failure(stderr: &str) -> &'static str {
    if RATE_LIMIT_MARKERS
        .iter()
        .any(|marker| stderr.contains(marker))
    {
        crate::rate_limit::RATE_LIMIT_CODE
    } else if stderr.contains(YTDLP_FORMAT_UNAVAILABLE) {
        "no_playable_format"
    } else {
        "ytdlp_failed"
    }
}

/// YouTube stamps the expiry on its URLs, as an `/expire/<unix>/` path
/// segment (HLS playlists) or an `expire=<unix>` query parameter.
fn parse_expiry(stream_url: &str) -> Option<u64> {
    ["/expire/", "expire="].iter().find_map(|marker| {
        let rest = &stream_url[stream_url.find(marker)? + marker.len()..];
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        digits.parse().ok()
    })
}

/// Whether YouTube answers at all, to tell "the URL expired" from "there is no way out".
pub fn can_reach_youtube() -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::sync::mpsc;

    // DNS has no timeout of its own, so the whole probe runs against one deadline.
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let reachable = (CONNECTIVITY_HOST, 443)
            .to_socket_addrs()
            .ok()
            .and_then(|mut addresses| addresses.next())
            .is_some_and(|address| {
                TcpStream::connect_timeout(&address, CONNECTIVITY_TIMEOUT).is_ok()
            });
        let _ = sender.send(reachable);
    });
    receiver.recv_timeout(CONNECTIVITY_TIMEOUT).unwrap_or(false)
}

fn validate_youtube_url(url: &str) -> Result<(), AppError> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or_else(|| AppError::new("invalid_url"))?;

    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    if ALLOWED_HOSTS.contains(&host.as_str()) {
        Ok(())
    } else {
        Err(AppError::new("not_youtube"))
    }
}

fn find_binary() -> Option<PathBuf> {
    let from_env = std::env::var_os("PATH").unwrap_or_default();
    EXTRA_BIN_DIRS
        .iter()
        .map(PathBuf::from)
        .chain(std::env::split_paths(&from_env))
        .map(|dir| dir.join("yt-dlp"))
        .find(|candidate| candidate.is_file())
}

/// yt-dlp shells out to helpers (a JS runtime, ffmpeg) that also live in Homebrew.
fn child_path() -> std::ffi::OsString {
    let from_env = std::env::var_os("PATH").unwrap_or_default();
    let dirs = EXTRA_BIN_DIRS
        .iter()
        .map(PathBuf::from)
        .chain(std::env::split_paths(&from_env));
    std::env::join_paths(dirs).unwrap_or(from_env)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_rate_limits_apart_from_other_failures() {
        let bot_check = "ERROR: [youtube] 0D5ArpBlCe4: Sign in to confirm you\u{2019}re not a bot. Use --cookies-from-browser or --cookies";
        assert_eq!(classify_failure(bot_check), "rate_limited");
        assert_eq!(
            classify_failure(
                "ERROR: unable to download video data: HTTP Error 429: Too Many Requests"
            ),
            "rate_limited"
        );
        assert_eq!(
            classify_failure("ERROR: [youtube] x: HTTP Error 429"),
            "rate_limited"
        );
        assert_eq!(
            classify_failure("ERROR: [youtube] x: This content isn't available, try again later."),
            "rate_limited"
        );
        assert_eq!(
            classify_failure(
                "ERROR: [youtube] x: This content isn\u{2019}t available, try again later."
            ),
            "rate_limited"
        );

        assert_eq!(
            classify_failure(
                "ERROR: [youtube] x: Requested format is not available. Use --list-formats"
            ),
            "no_playable_format"
        );
        let age_check = "ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.";
        assert_eq!(classify_failure(age_check), "ytdlp_failed");
        assert_eq!(
            classify_failure("ERROR: [youtube] x: Sign in to confirm you're not a bot."),
            "rate_limited"
        );
        assert_eq!(
            classify_failure("ERROR: [youtube] x: This video is unavailable"),
            "ytdlp_failed"
        );
        assert_eq!(
            classify_failure("ERROR: unable to download webpage: HTTP Error 403: Forbidden"),
            "ytdlp_failed"
        );
        assert_eq!(classify_failure(""), "ytdlp_failed");
    }

    fn shell(script: &str) -> Command {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        command
    }

    #[test]
    fn a_command_that_ends_in_time_returns_its_output() {
        let output = run_with_timeout(
            shell("echo out; echo err >&2; exit 3"),
            Duration::from_secs(5),
        )
        .unwrap()
        .expect("it ends well within the timeout");

        assert_eq!(output.status.code(), Some(3));
        assert_eq!(String::from_utf8_lossy(&output.stdout), "out\n");
        assert_eq!(String::from_utf8_lossy(&output.stderr), "err\n");
    }

    #[test]
    fn a_command_that_hangs_is_killed_along_with_what_it_started() {
        let started = Instant::now();
        // The background sleep inherits the pipes, as yt-dlp's helpers do.
        let outcome =
            run_with_timeout(shell("sleep 30 & sleep 30"), Duration::from_millis(200)).unwrap();

        assert!(outcome.is_none());
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn reads_the_expiry_from_hls_and_query_style_urls() {
        let hls = "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1791472858/ei/abc/itag/234";
        assert_eq!(parse_expiry(hls), Some(1791472858));

        let direct = "https://rr4---sn.googlevideo.com/videoplayback?expire=1791466727&ei=abc";
        assert_eq!(parse_expiry(direct), Some(1791466727));

        assert_eq!(parse_expiry("https://example.com/playlist.m3u8"), None);
        assert_eq!(parse_expiry("https://example.com/expire/soon/"), None);
    }
}
