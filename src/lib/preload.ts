// Preloading of the next track: while one plays, the one that would follow it
// is resolved ahead of time and kept in memory, so the switch at the end
// doesn't have to wait for a resolution. Nothing here is ever written to disk.

import { afterEnded, type RepeatMode } from "./mediaNavigation";
import { isExpiring } from "./recovery";
import type { ResolvedAudio } from "./tauri";

/** Preload once this little of the track is left. */
const PRELOAD_WINDOW_SECONDS = 60;
/** Tracks shorter than this are preloaded near their start instead. */
const SHORT_TRACK_SECONDS = 120;
/** How long a short track must have played without interruption before preloading. */
const SETTLE_MS = 5_000;

interface Identified {
  id: string;
}

/**
 * The track worth preloading: the one the end of the current track would
 * start. Nothing when that end restarts the same track (repeat one, or repeat
 * all on a single track) or stops.
 */
export function preloadTarget<T extends Identified>(
  tracks: T[],
  currentId: string | null,
  repeat: RepeatMode,
): T | null {
  const action = afterEnded(tracks, currentId, repeat);
  return action.kind === "play" ? action.track : null;
}

interface PlaybackSample {
  duration: number;
  currentTime: number;
  /** Uninterrupted playback so far, in ms; 0 while not playing. */
  playingForMs: number;
}

/** Whether playback has reached the point where the next track should be resolved. */
export function isPreloadDue({ duration, currentTime, playingForMs }: PlaybackSample): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (duration < SHORT_TRACK_SECONDS) return playingForMs >= SETTLE_MS;
  return duration - currentTime <= PRELOAD_WINDOW_SECONDS;
}

/** A preloaded stream is only used with a known expiry that isn't about to pass. */
export function isUsable(resolved: ResolvedAudio, now: number): boolean {
  return resolved.expiresAt !== null && !isExpiring(resolved.expiresAt, now);
}

type Slot =
  | { state: "empty" }
  | { state: "resolving"; currentId: string; targetId: string; promise: Promise<ResolvedAudio> }
  | { state: "ready"; currentId: string; targetId: string; resolved: ResolvedAudio }
  | { state: "failed"; currentId: string; targetId: string };

export type Preloaded =
  | { kind: "ready"; resolved: ResolvedAudio }
  /** Still resolving: wait for this same promise instead of resolving again. */
  | { kind: "pending"; promise: Promise<ResolvedAudio> };

interface PreloaderOptions<T> {
  /** Obtains the stream of a track; free to answer from a cache instead of resolving. */
  resolve: (target: T) => Promise<ResolvedAudio>;
}

interface PreloadInput<T> {
  currentId: string | null;
  /** The track to preload for `currentId`, if any. */
  target: T | null;
  /** Whether playback has reached the preload point. */
  due: boolean;
}

/**
 * A one-slot cache for the next track, keyed by the pair "current track,
 * track that follows it". It holds at most one resolution, in flight or done.
 */
export function createPreloader<T extends Identified>({ resolve }: PreloaderOptions<T>) {
  let slot: Slot = { state: "empty" };

  const matches = (currentId: string | null, targetId: string | undefined) =>
    slot.state !== "empty" && slot.currentId === currentId && slot.targetId === targetId;

  return {
    /**
     * Re-evaluates the slot. To be called as playback progresses and whenever
     * the library, its order, the repeat mode or the current track change: an
     * entry for a pair that no longer holds is dropped, and a new resolution
     * starts if one is due and none is in the slot.
     */
    update({ currentId, target, due }: PreloadInput<T>) {
      if (slot.state !== "empty" && !matches(currentId, target?.id)) slot = { state: "empty" };
      if (!currentId || !target || !due || slot.state !== "empty") return;

      const promise = resolve(target);
      const mine: Slot = { state: "resolving", currentId, targetId: target.id, promise };
      slot = mine;
      promise.then(
        (resolved) => {
          // A resolution that outlived its pair is simply dropped.
          if (slot === mine) slot = { state: "ready", currentId, targetId: target.id, resolved };
        },
        () => {
          // No visible error and no retry for this pair: the switch falls back to resolving normally.
          if (slot === mine) slot = { state: "failed", currentId, targetId: target.id };
        },
      );
    },

    /**
     * Hands over what the slot holds for this pair and empties it. Null when
     * there is nothing usable: no entry, another pair, a failed resolution,
     * or a stream too close to expiring.
     */
    take(currentId: string | null, targetId: string, now: number): Preloaded | null {
      if (!matches(currentId, targetId)) return null;
      const held = slot;
      slot = { state: "empty" };

      if (held.state === "ready") return isUsable(held.resolved, now) ? { kind: "ready", resolved: held.resolved } : null;
      if (held.state === "resolving") return { kind: "pending", promise: held.promise };
      return null;
    },

    /** For diagnostics and tests. */
    state: () => slot.state,
  };
}
