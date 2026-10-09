// Pure rules behind stream recovery. No timers: every decision is taken from
// timestamps handed in by the caller, so nothing degrades when the webview
// throttles timers with the popover closed.

const HAVE_CURRENT_DATA = 2;

const STALL_THRESHOLD_MS = 10_000;
const EXPIRY_MARGIN_MS = 60_000;
export const MAX_RECOVERY_ATTEMPTS = 2;
/** Playback must hold this long after a recovery before the attempts start over. */
export const STABLE_PLAYBACK_MS = 10_000;

interface StallSample {
  now: number;
  /** The user asked for playback (as opposed to having paused). */
  wantsPlaying: boolean;
  readyState: number;
  currentTime: number;
}

/**
 * Detects playback that should be running but has made no progress for the
 * threshold while short of data. `observe` returns true once that happens.
 */
export function createStallDetector(thresholdMs = STALL_THRESHOLD_MS) {
  let stalledSince: number | null = null;
  let lastTime: number | null = null;

  return {
    observe({ now, wantsPlaying, readyState, currentTime }: StallSample): boolean {
      const advanced = lastTime !== null && currentTime !== lastTime;
      lastTime = currentTime;

      if (!wantsPlaying || readyState > HAVE_CURRENT_DATA || advanced) {
        stalledSince = null;
        return false;
      }
      stalledSince ??= now;
      return now - stalledSince >= thresholdMs;
    },
    reset() {
      stalledSince = null;
      lastTime = null;
    },
  };
}

const STALL_CHECK_INTERVAL_MS = 2_000;

interface PlaybackCondition {
  /** A track has been loaded and has played, so a failure is recovered rather than just reported. */
  active: boolean;
  wantsPlaying: boolean;
  recovering: boolean;
  readyState: number;
}

/**
 * Whether the stall detector needs a clock of its own right now. A stalled
 * element fires no events to check it on, so one is needed exactly while
 * playback is wanted and has no data to advance with; never while paused,
 * stopped, playing normally or already recovering.
 */
export function needsStallWatch({ active, wantsPlaying, recovering, readyState }: PlaybackCondition): boolean {
  return active && wantsPlaying && !recovering && readyState <= HAVE_CURRENT_DATA;
}

interface StallWatchOptions {
  /** Runs on every tick while the watch is on. */
  onTick: () => void;
  intervalMs?: number;
  timers?: { set: (handler: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}

/**
 * The periodic check behind the stall detector. It holds a timer only while
 * `sync(true)` is in force and none otherwise, so nothing is left running in
 * pause or with nothing loaded. The detector itself still decides from
 * timestamps; this only makes sure it gets asked.
 */
export function createStallWatch({ onTick, intervalMs = STALL_CHECK_INTERVAL_MS, timers }: StallWatchOptions) {
  const set = timers?.set ?? ((handler, ms) => setInterval(handler, ms));
  const clear = timers?.clear ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  let handle: unknown = null;

  const stop = () => {
    if (handle === null) return;
    clear(handle);
    handle = null;
  };

  return {
    /** Turns the watch on or off to match `needed`; calling it again with the same value changes nothing. */
    sync(needed: boolean) {
      if (!needed) {
        stop();
      } else if (handle === null) {
        handle = set(onTick, intervalMs);
      }
    },
    stop,
    isRunning: () => handle !== null,
  };
}

/**
 * Tells an expired stream from an unreachable YouTube. The probe is skipped
 * when the system already reports being offline.
 */
export async function canReachYoutube(systemOnline: boolean, probe: () => Promise<boolean>): Promise<boolean> {
  if (!systemOnline) return false;
  try {
    return await probe();
  } catch {
    return false;
  }
}

/** True when the stream URL has expired or will within the margin. Unknown expiry never counts. */
export function isExpiring(expiresAtSeconds: number | null, now: number, marginMs = EXPIRY_MARGIN_MS): boolean {
  if (expiresAtSeconds === null) return false;
  return expiresAtSeconds * 1000 - now < marginMs;
}
