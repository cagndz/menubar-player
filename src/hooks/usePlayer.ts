import { useCallback, useEffect, useReducer, useRef } from "react";
import { toUserMessage } from "../lib/errors";
import { clampSeek } from "../lib/mediaNavigation";
import { createNavigationQueue, SUPERSEDED } from "../lib/navigationQueue";
import { trackPosition } from "../lib/positionTracker";
import { isRateLimited } from "../lib/rateLimit";
import {
  canReachYoutube,
  createStallDetector,
  createStallWatch,
  isExpiring,
  MAX_RECOVERY_ATTEMPTS,
  needsStallWatch,
  STABLE_PLAYBACK_MS,
} from "../lib/recovery";
import { cachedStream, forgetStream, resolveStream } from "../lib/resolver";
import { isReusable } from "../lib/streamCache";
import { strings } from "../lib/strings";
import { checkConnectivity, debugLog, type ResolvedAudio } from "../lib/tauri";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface PlayerState {
  status: PlayerStatus;
  trackId: string | null;
  title: string | null;
  error: string | null;
  /** The error can be retried from the saved position. */
  retryable: boolean;
  /** The stream is being re-resolved; the rest of the state is held still meanwhile. */
  recovering: boolean;
  currentTime: number;
  duration: number;
}

type Action =
  | { type: "load"; quiet: boolean; track: TrackPreview | null }
  | { type: "resolved"; trackId: string; title: string }
  | { type: "playing" }
  | { type: "paused" }
  | { type: "failed"; error: string; retryable: boolean }
  | { type: "time"; currentTime: number }
  | { type: "duration"; duration: number }
  | { type: "recovering"; position: number; resume: boolean }
  | { type: "recovered"; playing: boolean; currentTime: number; duration: number };

/** What is known of a track before it is resolved: enough to show it at once. */
interface TrackPreview {
  id: string;
  title: string;
}

interface LoadOptions {
  /** The track being loaded, when it comes from the library. */
  track?: TrackPreview;
  /** Wait for a pause in the presses before resolving (next / previous). */
  settle?: boolean;
}

/** What a way of obtaining a stream can use while it works. */
interface ObtainContext {
  showLoading: () => void;
  /** False once a later request has replaced this one. */
  isCurrent: () => boolean;
}

/** A stream to play, and what is already known about starting it. */
interface ObtainedStream {
  resolved: ResolvedAudio;
  /** Resume position, when finding the stream already required looking it up. */
  startAt?: number;
  /** It was resolved before this playback; if it fails to load, recovery takes over. */
  reused?: boolean;
}

interface PlayerOptions {
  /** Runs once a URL resolves; returns the position (seconds) to start from. */
  onResolved: (resolved: ResolvedAudio) => Promise<number>;
  /** Receives the position to persist for a track. */
  onPosition: (trackId: string, position: number) => Promise<void>;
  /** Audio actually started playing. */
  onPlaying: () => void;
  /** The current track played to its end. */
  onEnded: () => void;
}

const LOADING_TIMEOUT_MS = 15_000;
const MEDIA_STEP_TIMEOUT_MS = 15_000;
const POSITION_SAVE_INTERVAL_MS = 10_000;
// How far from its target a restored position may land and still count.
const SEEK_TOLERANCE_SECONDS = 2;
const HAVE_CURRENT_DATA = 2;
const HAVE_FUTURE_DATA = 3;

const LOGGED_EVENTS = ["loadstart", "loadedmetadata", "canplay", "stalled", "waiting", "error"] as const;
// Besides `timeupdate`, the moments at which a stall is worth re-checking.
const STALL_CHECK_EVENTS = ["waiting", "stalled", "progress", "suspend"] as const;
// Moments at which playback may have started or stopped needing the periodic stall check.
const WATCH_SYNC_EVENTS = ["waiting", "stalled", "playing", "canplay", "pause", "ended", "emptied", "error"] as const;

const initialState: PlayerState = {
  status: "idle",
  trackId: null,
  title: null,
  error: null,
  retryable: false,
  recovering: false,
  currentTime: 0,
  duration: 0,
};

function reducer(state: PlayerState, action: Action): PlayerState {
  // While recovering, the element is torn down and rebuilt; none of what it
  // reports in between should reach the UI.
  const frozen = state.recovering;

  switch (action.type) {
    case "load":
      // A quiet start already has its stream: it goes straight to the new track, with no loading state.
      // When the track is known up front, the UI and Now Playing show it before it is resolved.
      return {
        ...initialState,
        status: action.quiet ? "playing" : "loading",
        trackId: action.track?.id ?? null,
        title: action.track?.title ?? null,
      };
    case "resolved":
      return { ...state, trackId: action.trackId, title: action.title };
    case "playing":
      return frozen || state.status === "error" ? state : { ...state, status: "playing" };
    case "paused":
      // Swapping `src` also fires `pause`; only a real pause leaves "playing".
      return !frozen && state.status === "playing" ? { ...state, status: "paused" } : state;
    case "failed":
      return { ...state, status: "error", error: action.error, retryable: action.retryable, recovering: false };
    case "time":
      return frozen ? state : { ...state, currentTime: action.currentTime };
    case "duration":
      return frozen ? state : { ...state, duration: action.duration };
    case "recovering":
      return {
        ...state,
        // Show what the recovery is heading back to, whatever state it started from.
        status: action.resume ? "playing" : "paused",
        error: null,
        retryable: false,
        recovering: true,
        currentTime: action.position,
      };
    case "recovered":
      return {
        ...state,
        status: action.playing ? "playing" : "paused",
        recovering: false,
        currentTime: action.currentTime,
        duration: action.duration,
      };
  }
}

function describeAudio(audio: HTMLAudioElement): string {
  const buffered = audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1).toFixed(1) : "0";
  const error = audio.error ? `${audio.error.code} (${audio.error.message || "no message"})` : "none";
  return `error.code=${error} networkState=${audio.networkState} readyState=${audio.readyState} buffered=${buffered}s duration=${audio.duration}`;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

/** Resolves on `event`; rejects on a media error or once the timeout passes. */
function waitFor(audio: HTMLAudioElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeEventListener(event, onEvent);
      audio.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`media error ${audio.error?.code ?? "?"} while waiting for ${event}`));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    }, MEDIA_STEP_TIMEOUT_MS);
    audio.addEventListener(event, onEvent);
    audio.addEventListener("error", onError);
  });
}

/**
 * Points the element at a fresh URL and puts playback back where it was. The
 * position is checked after seeking, since a new HLS source is free to land
 * somewhere else; one more seek is tried before giving up.
 */
async function restoreSource(audio: HTMLAudioElement, url: string, position: number, resume: boolean) {
  const metadata = waitFor(audio, "loadedmetadata");
  audio.src = url;
  await metadata;

  if (position > 0) {
    for (let attempt = 1; ; attempt++) {
      const seeked = waitFor(audio, "seeked");
      audio.currentTime = position;
      await seeked;

      const drift = Math.abs(audio.currentTime - position);
      debugLog(`[recovery] seek ${attempt}: target=${position.toFixed(1)} landed=${audio.currentTime.toFixed(1)}`);
      if (drift <= SEEK_TOLERANCE_SECONDS) break;
      if (attempt === 2) throw new Error(`seek landed ${drift.toFixed(1)}s away from its target`);
      if (audio.readyState < HAVE_FUTURE_DATA) await waitFor(audio, "canplay");
    }
  }

  if (resume) {
    await Promise.all([waitFor(audio, "playing"), audio.play()]);
  }
}

export function usePlayer(options: PlayerOptions) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const requestRef = useRef(0);
  const timeoutRef = useRef<number | undefined>(undefined);
  const trackIdRef = useRef<string | null>(null);
  const pageUrlRef = useRef<string | null>(null);
  const expiresAtRef = useRef<number | null>(null);
  // Position to jump to once the new source has metadata; 0 when there is none.
  const pendingStartRef = useRef(0);
  const trackerRef = useRef<ReturnType<typeof trackPosition> | null>(null);

  // What the user asked for, as opposed to what the element happens to be doing.
  const wantsPlayingRef = useRef(false);
  // Last position reported while the element had data; `currentTime` is 0 after a failure.
  const lastGoodTimeRef = useRef(0);
  // True once the first load has played; from then on failures are recovered, not just reported.
  const activeRef = useRef(false);
  // True from the moment a track starts loading until it plays or fails.
  const startingRef = useRef(false);
  const recoveringRef = useRef(false);
  const attemptsRef = useRef(0);
  const stableSinceRef = useRef<number | null>(null);
  // Whole second last published to React; -1 forces the next one through.
  const shownSecondRef = useRef(-1);
  const navigationRef = useRef<ReturnType<typeof createNavigationQueue> | null>(null);
  navigationRef.current ??= createNavigationQueue();
  const stallRef = useRef<ReturnType<typeof createStallDetector> | null>(null);
  stallRef.current ??= createStallDetector();

  const [state, dispatch] = useReducer(reducer, initialState);

  const clearLoadingTimeout = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  }, []);

  // Each loading phase (yt-dlp, then the media itself) gets its own deadline.
  const armLoadingTimeout = useCallback(
    (error: string) => {
      clearLoadingTimeout();
      timeoutRef.current = window.setTimeout(() => {
        const audio = audioRef.current;
        if (!audio) return;
        debugLog(`[audio] loading timeout | ${describeAudio(audio)}`);
        requestRef.current++;
        startingRef.current = false;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        dispatch({ type: "failed", error, retryable: false });
      }, LOADING_TIMEOUT_MS);
    },
    [clearLoadingTimeout],
  );

  /** Persists the current position right away (seek, switching track, quitting). */
  const savePosition = useCallback((): Promise<void> => trackerRef.current?.saveNow() ?? Promise.resolve(), []);

  /**
   * Re-resolves the stream of the current track and restores position and
   * play state. Used when the URL expired or the media failed mid-track.
   */
  const recover = useCallback(
    async (reason: string) => {
      const audio = audioRef.current;
      const trackId = trackIdRef.current;
      const pageUrl = pageUrlRef.current;
      if (!audio || !trackId || !pageUrl || recoveringRef.current) return;

      const position = audio.ended ? 0 : lastGoodTimeRef.current;
      const resume = wantsPlayingRef.current;
      const request = ++requestRef.current;
      const superseded = () => request !== requestRef.current;

      recoveringRef.current = true;
      stableSinceRef.current = null;
      stallRef.current?.reset();
      clearLoadingTimeout();
      debugLog(`[recovery] start reason="${reason}" position=${position.toFixed(1)} resume=${resume}`);
      dispatch({ type: "recovering", position, resume });
      // Whatever stream was remembered for this track is the one that just failed.
      forgetStream(trackId);
      void optionsRef.current.onPosition(trackId, position);

      const giveUp = (error: string) => {
        recoveringRef.current = false;
        // Nothing is loaded any more: until the user retries, neither the stall
        // check nor a stray media error may start another recovery by itself.
        activeRef.current = false;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        dispatch({ type: "failed", error, retryable: true });
      };

      // A stream that died because YouTube is unreachable isn't worth an attempt.
      if (!(await canReachYoutube(navigator.onLine, checkConnectivity))) {
        if (superseded()) return;
        debugLog("[recovery] YouTube unreachable; not re-resolving");
        giveUp(strings.errors.cantReachYoutube);
        return;
      }

      while (attemptsRef.current < MAX_RECOVERY_ATTEMPTS) {
        if (superseded()) return;
        const attempt = ++attemptsRef.current;
        try {
          const resolved = await resolveStream(pageUrl);
          if (superseded()) return;
          expiresAtRef.current = resolved.expiresAt;

          await restoreSource(audio, resolved.streamUrl, position, resume);
          if (superseded()) return;

          recoveringRef.current = false;
          lastGoodTimeRef.current = audio.currentTime;
          debugLog(`[recovery] done attempt=${attempt} t=${audio.currentTime.toFixed(1)} paused=${audio.paused}`);
          dispatch({
            type: "recovered",
            playing: resume,
            currentTime: audio.currentTime,
            duration: audio.duration,
          });
          return;
        } catch (err) {
          if (superseded()) return;
          debugLog(`[recovery] attempt ${attempt} failed: ${describeFailure(err)}`);
          if (isRateLimited(err)) {
            // Not a failure of this stream, and retrying would only add requests:
            // the attempt isn't counted and nothing more is tried.
            attemptsRef.current--;
            giveUp(strings.errors.rateLimited);
            return;
          }
        }
      }

      giveUp(strings.errors.recoveryFailed);
    },
    [clearLoadingTimeout],
  );

  useEffect(() => {
    const audio = audioRef.current;
    const stall = stallRef.current;
    if (!audio || !stall) return;

    const onPlaying = () => {
      clearLoadingTimeout();
      startingRef.current = false;
      activeRef.current = true;
      debugLog(`[audio] playing | ${describeAudio(audio)}`);
      dispatch({ type: "playing" });
      optionsRef.current.onPlaying();
    };
    const onPause = () => {
      // Resetting the element for a new track pauses it too; that isn't the user pausing.
      if (!startingRef.current) dispatch({ type: "paused" });
    };
    const onEnded = () => {
      wantsPlayingRef.current = false;
      dispatch({ type: "paused" });
      optionsRef.current.onEnded();
    };
    const onMetadata = () => {
      if (pendingStartRef.current > 0) {
        audio.currentTime = pendingStartRef.current;
        pendingStartRef.current = 0;
      }
    };

    // Driven by media events and their timestamps rather than a timer, so it
    // keeps its accuracy when timers are throttled with the popover closed.
    const checkStall = () => {
      if (!activeRef.current || recoveringRef.current) return;
      const stalled = stall.observe({
        now: Date.now(),
        wantsPlaying: wantsPlayingRef.current,
        readyState: audio.readyState,
        currentTime: audio.currentTime,
      });
      if (stalled) {
        debugLog(`[audio] stalled for too long | ${describeAudio(audio)}`);
        void recover("stalled");
      }
    };

    // The playback time is the one thing that changes on every tick, and
    // re-rendering for it was most of the CPU spent while playing. Nobody sees
    // it with the popover closed, so nothing is published then; when visible,
    // once per displayed second is all the time text can show anyway.
    // Everything that must keep running (position saving, preloading, stall
    // detection) reads the audio element directly instead.
    const publishTime = (force: boolean) => {
      if (document.visibilityState !== "visible") return;
      const second = Math.floor(audio.currentTime);
      if (!force && second === shownSecondRef.current) return;
      shownSecondRef.current = second;
      dispatch({ type: "time", currentTime: audio.currentTime });
    };
    // Reopening the popover shows the current time at once.
    const onVisibility = () => publishTime(true);

    // A stalled element fires no events to run the check on, so while playback
    // is wanted and short of data a 2 s clock asks the detector. It exists only
    // then: no timer runs in pause, with nothing loaded or while playing fine.
    const watch = createStallWatch({
      onTick: () => {
        checkStall();
        syncWatch();
      },
    });
    const syncWatch = () =>
      watch.sync(
        needsStallWatch({
          active: activeRef.current,
          wantsPlaying: wantsPlayingRef.current,
          recovering: recoveringRef.current,
          readyState: audio.readyState,
        }),
      );

    const onTime = () => {
      publishTime(false);

      if (activeRef.current && !recoveringRef.current && audio.readyState >= HAVE_CURRENT_DATA) {
        lastGoodTimeRef.current = audio.currentTime;

        // Recovery attempts only count as consecutive until playback holds for a while.
        if (attemptsRef.current > 0 && !audio.paused) {
          stableSinceRef.current ??= Date.now();
          if (Date.now() - stableSinceRef.current >= STABLE_PLAYBACK_MS) {
            attemptsRef.current = 0;
            stableSinceRef.current = null;
          }
        }
      }
      checkStall();
    };
    const onDuration = () => dispatch({ type: "duration", duration: audio.duration });
    const onLogged = (event: Event) => debugLog(`[audio] ${event.type} | ${describeAudio(audio)}`);
    const onError = () => {
      // Clearing `src` between loads also raises an error event, and during a
      // recovery the step that is waiting on the element handles it.
      if (!audio.getAttribute("src") || recoveringRef.current) return;
      clearLoadingTimeout();
      if (activeRef.current) {
        void recover("media error");
      } else {
        startingRef.current = false;
        dispatch({ type: "failed", error: strings.errors.playbackFailed, retryable: false });
      }
    };

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("error", onError);
    for (const name of LOGGED_EVENTS) audio.addEventListener(name, onLogged);
    for (const name of STALL_CHECK_EVENTS) audio.addEventListener(name, checkStall);
    for (const name of WATCH_SYNC_EVENTS) audio.addEventListener(name, syncWatch);
    // Reopening the popover is one more chance to notice a stall that produced no events.
    document.addEventListener("visibilitychange", checkStall);
    document.addEventListener("visibilitychange", onVisibility);

    const tracker = trackPosition(audio, {
      trackId: () => trackIdRef.current,
      isSettled: () => pendingStartRef.current === 0 && !recoveringRef.current,
      save: (trackId, position) => optionsRef.current.onPosition(trackId, position),
      intervalMs: POSITION_SAVE_INTERVAL_MS,
    });
    trackerRef.current = tracker;

    return () => {
      tracker.stop();
      trackerRef.current = null;
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("error", onError);
      for (const name of LOGGED_EVENTS) audio.removeEventListener(name, onLogged);
      for (const name of STALL_CHECK_EVENTS) audio.removeEventListener(name, checkStall);
      for (const name of WATCH_SYNC_EVENTS) audio.removeEventListener(name, syncWatch);
      watch.stop();
      document.removeEventListener("visibilitychange", checkStall);
      document.removeEventListener("visibilitychange", onVisibility);
      clearLoadingTimeout();
    };
  }, [clearLoadingTimeout, recover]);

  /**
   * Starts a track. Only how its stream URL is obtained differs between
   * callers; everything from there on is this one path, so resuming, position
   * tracking, the expiry check, recovery and what the UI and Now Playing show
   * can't differ between a track resolved now and one resolved ahead of time.
   */
  const startTrack = useCallback(
    async (
      obtain: (context: ObtainContext) => Promise<ObtainedStream>,
      mode: { quiet: boolean; recoverable: boolean; track?: TrackPreview },
    ) => {
      const audio = audioRef.current;
      if (!audio) return;

      // The outgoing track keeps its position before the element is reset.
      void savePosition();
      // Known at once when it comes from the library, so the next press of
      // "next" or "previous" goes on from here instead of from the old track.
      const track = mode.track ?? null;
      trackIdRef.current = track?.id ?? null;
      pageUrlRef.current = null;
      expiresAtRef.current = null;
      pendingStartRef.current = 0;
      activeRef.current = false;
      recoveringRef.current = false;
      startingRef.current = true;
      shownSecondRef.current = -1;
      attemptsRef.current = 0;
      wantsPlayingRef.current = true;
      stallRef.current?.reset();

      const request = ++requestRef.current;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      dispatch({ type: "load", quiet: mode.quiet, track });
      armLoadingTimeout(strings.errors.resolveTimeout);

      const isCurrent = () => request === requestRef.current;
      try {
        const obtained = await obtain({
          isCurrent,
          showLoading: () => {
            if (isCurrent()) dispatch({ type: "load", quiet: false, track });
          },
        });
        if (request !== requestRef.current) return;
        const { resolved } = obtained;
        debugLog(`[audio] resolved id=${resolved.id} host=${new URL(resolved.streamUrl).host}`);

        const startAt = obtained.startAt ?? (await optionsRef.current.onResolved(resolved));
        if (request !== requestRef.current) return;

        trackIdRef.current = resolved.id;
        pageUrlRef.current = resolved.pageUrl;
        expiresAtRef.current = resolved.expiresAt;
        pendingStartRef.current = startAt;
        lastGoodTimeRef.current = startAt;
        // A stream resolved ahead of time may have gone bad since; if it fails
        // to load, that is a job for the usual recovery, not a dead end.
        activeRef.current = mode.recoverable || obtained.reused === true;
        trackerRef.current?.restartInterval();
        dispatch({ type: "resolved", trackId: resolved.id, title: resolved.title });

        armLoadingTimeout(strings.errors.playbackTimeout);
        audio.src = resolved.streamUrl;
        await audio.play();
      } catch (err) {
        if (request !== requestRef.current || err === SUPERSEDED) return;
        // A superseded play() rejects with AbortError; the media error event covers real failures.
        if (err instanceof DOMException) {
          debugLog(`[audio] play() rejected: ${err.name}: ${err.message} | ${describeAudio(audio)}`);
          if (err.name === "NotAllowedError") {
            clearLoadingTimeout();
            startingRef.current = false;
            dispatch({ type: "failed", error: strings.errors.playbackBlocked, retryable: false });
          }
          return;
        }
        clearLoadingTimeout();
        startingRef.current = false;
        dispatch({
          type: "failed",
          error: toUserMessage(err, strings.errors.resolveFailed),
          retryable: false,
        });
      }
    },
    [armLoadingTimeout, clearLoadingTimeout, savePosition],
  );

  /**
   * Plays a track from its link. When a stream resolved earlier for that
   * track will still outlive what is left of it, that one is used and YouTube
   * isn't asked again; otherwise the link is resolved. With `settle`, the
   * resolution waits for the presses to pause and for any other one to end.
   */
  const load = useCallback(
    (url: string, options: LoadOptions = {}) => {
      const { track, settle } = options;
      const resolve = (isCurrent: () => boolean) =>
        settle && navigationRef.current
          ? navigationRef.current.run(isCurrent, () => resolveStream(url))
          : resolveStream(url);

      const cached = track ? cachedStream(track.id) : null;
      if (!cached) {
        return startTrack(async ({ isCurrent }) => ({ resolved: await resolve(isCurrent) }), {
          quiet: false,
          recoverable: false,
          track,
        });
      }
      return startTrack(
        async ({ showLoading, isCurrent }) => {
          // Where the track resumes decides how much of it is left, and so whether the stream lasts.
          const startAt = await optionsRef.current.onResolved(cached);
          if (isReusable(cached, cached.duration - startAt, Date.now())) {
            debugLog(`[audio] ${cached.id}: reusing the stream resolved earlier`);
            return { resolved: cached, startAt, reused: true };
          }
          forgetStream(cached.id);
          showLoading();
          return { resolved: await resolve(isCurrent) };
        },
        // Quiet until proven otherwise: with the stream in hand there is nothing to wait for.
        { quiet: true, recoverable: false, track },
      );
    },
    [startTrack],
  );

  /**
   * Plays a track whose stream was resolved ahead of time, or is still being
   * resolved. With the stream in hand there is no loading state; with a
   * resolution in flight it is waited for, under the usual limit.
   */
  const playResolved = useCallback(
    (source: ResolvedAudio | Promise<ResolvedAudio>, track?: TrackPreview) =>
      startTrack(async () => ({ resolved: await source }), {
        quiet: !(source instanceof Promise),
        recoverable: true,
        track,
      }),
    [startTrack],
  );

  /** The track currently loaded, read without going through React state. */
  const getTrackId = useCallback(() => trackIdRef.current, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.getAttribute("src") || recoveringRef.current || !audio.paused) return;

    wantsPlayingRef.current = true;
    // A stream about to expire is replaced before playing, not after it fails.
    if (isExpiring(expiresAtRef.current, Date.now())) {
      attemptsRef.current = 0;
      void recover("stream expiring");
      return;
    }
    void audio.play().catch((err) => debugLog(`[audio] play() rejected: ${err}`));
  }, [recover]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.getAttribute("src") || recoveringRef.current) return;
    wantsPlayingRef.current = false;
    audio.pause();
  }, []);

  const toggle = useCallback(() => {
    if (audioRef.current?.paused) {
      play();
    } else {
      pause();
    }
  }, [play, pause]);

  const seek = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio || !audio.getAttribute("src") || recoveringRef.current) return;
      const target = clampSeek(time, audio.duration);
      audio.currentTime = target;
      lastGoodTimeRef.current = target;
      dispatch({ type: "time", currentTime: target });
      void savePosition();
    },
    [savePosition],
  );

  /** Starts the current track over and plays it. */
  const restart = useCallback(() => {
    seek(0);
    play();
  }, [seek, play]);

  /** Tries the recovery again after it gave up, from the saved position. */
  const retry = useCallback(() => {
    attemptsRef.current = 0;
    void recover("retry");
  }, [recover]);

  // Development aids: break the stream on purpose to exercise recovery in
  // seconds. The condition lets the bundler drop them from release builds.
  const debug = import.meta.env.DEV
    ? {
        /** Swaps in a URL YouTube rejects with a 403, as an expired one would be. */
        invalidate: () => {
          const audio = audioRef.current;
          const src = audio?.getAttribute("src");
          if (!audio || !src) return;
          debugLog("[debug] invalidating the stream URL (expect a 403)");
          audio.src = src.replace(/\/expire\/\d+\//, "/expire/1000000000/");
        },
        /** Backdates the known expiry, so the next play re-resolves first. */
        expire: () => {
          debugLog("[debug] marking the stream as expired; the next play re-resolves");
          expiresAtRef.current = 1_000_000_000;
        },
      }
    : null;

  return {
    audioRef,
    state,
    load,
    playResolved,
    getTrackId,
    play,
    pause,
    toggle,
    seek,
    restart,
    retry,
    savePosition,
    debug,
  };
}
