const HAVE_METADATA = 1;

/** The slice of HTMLAudioElement the tracker needs. */
export interface PositionSource extends EventTarget {
  readonly currentTime: number;
  readonly readyState: number;
  readonly paused: boolean;
  readonly ended: boolean;
}

interface TrackerOptions {
  /** Track being played, or null while nothing is loaded. */
  trackId: () => string | null;
  /** False while a pending initial seek makes `currentTime` meaningless. */
  isSettled: () => boolean;
  save: (trackId: string, position: number) => Promise<void>;
  intervalMs: number;
  now?: () => number;
}

/**
 * Persists the playback position: periodically while playing, on pause, and
 * as 0 once the audio ends, so a finished track starts over next time.
 */
export function trackPosition(audio: PositionSource, options: TrackerOptions) {
  const now = options.now ?? Date.now;
  let lastSavedAt = now();

  const saveNow = (): Promise<void> => {
    const trackId = options.trackId();
    if (!trackId || audio.readyState < HAVE_METADATA || !options.isSettled()) {
      return Promise.resolve();
    }
    lastSavedAt = now();
    return options.save(trackId, audio.ended ? 0 : audio.currentTime);
  };

  const onStop = () => void saveNow();
  const onTimeUpdate = () => {
    if (!audio.paused && now() - lastSavedAt >= options.intervalMs) void saveNow();
  };

  audio.addEventListener("pause", onStop);
  audio.addEventListener("ended", onStop);
  audio.addEventListener("timeupdate", onTimeUpdate);

  return {
    saveNow,
    /** Starts a fresh interval, e.g. when a new source begins loading. */
    restartInterval: () => {
      lastSavedAt = now();
    },
    stop: () => {
      audio.removeEventListener("pause", onStop);
      audio.removeEventListener("ended", onStop);
      audio.removeEventListener("timeupdate", onTimeUpdate);
    },
  };
}
