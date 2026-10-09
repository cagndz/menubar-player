// Pure rules behind track navigation: where "next", "previous" and the end of
// a track lead, and where a seek is allowed to land. `tracks` is always the
// library in the order the user sees it. The buttons in the popover and the
// system media keys both go through these.

export type RepeatMode = "off" | "all" | "one";

const REPEAT_MODES: readonly RepeatMode[] = ["off", "all", "one"];
const DEFAULT_REPEAT_MODE: RepeatMode = "all";

/** Past this point "previous" restarts the current track instead of leaving it. */
const RESTART_THRESHOLD_SECONDS = 3;
/** Fixed step of the skip buttons, whatever offset the system suggests. */
export const SKIP_SECONDS = 10;

interface Identified {
  id: string;
}

export type PreviousTarget<T> = { kind: "restart" } | { kind: "track"; track: T };
export type EndedAction<T> = { kind: "restart" } | { kind: "play"; track: T } | { kind: "stop" };

/** off -> all -> one -> off. */
export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return REPEAT_MODES[(REPEAT_MODES.indexOf(mode) + 1) % REPEAT_MODES.length];
}

/** Reads a stored repeat mode, falling back to the default for anything unexpected. */
export function parseRepeatMode(raw: unknown): RepeatMode {
  return REPEAT_MODES.includes(raw as RepeatMode) ? (raw as RepeatMode) : DEFAULT_REPEAT_MODE;
}

/** The track after the current one. Only "repeat all" wraps from the last to the first. */
function following<T extends Identified>(tracks: T[], currentId: string | null, repeat: RepeatMode): T | null {
  const index = tracks.findIndex((track) => track.id === currentId);
  if (index === -1) return null;
  if (index < tracks.length - 1) return tracks[index + 1];
  return repeat === "all" ? tracks[0] : null;
}

/**
 * Where a manual "next" goes, or null when there is nowhere to go. "Repeat
 * one" is ignored here: asking for the next track means the adjacent one.
 */
export function nextTarget<T extends Identified>(
  tracks: T[],
  currentId: string | null,
  repeat: RepeatMode,
): T | null {
  const target = following(tracks, currentId, repeat);
  return target && target.id !== currentId ? target : null;
}

/**
 * Where "previous" goes: back to the start of the current track once it is
 * past the threshold, otherwise to the track before. From the first track,
 * "repeat all" wraps to the last one; the other modes restart it.
 */
export function previousTarget<T extends Identified>(
  tracks: T[],
  currentId: string | null,
  currentTime: number,
  repeat: RepeatMode,
): PreviousTarget<T> {
  const index = tracks.findIndex((track) => track.id === currentId);
  if (currentTime > RESTART_THRESHOLD_SECONDS || index === -1) return { kind: "restart" };
  if (index > 0) return { kind: "track", track: tracks[index - 1] };
  if (repeat === "all" && tracks.length > 1) return { kind: "track", track: tracks[tracks.length - 1] };
  return { kind: "restart" };
}

/**
 * Which track controls make sense right now. "Next" needs another track to go
 * to; "previous" only needs a current track, since it can always restart it.
 */
export function availableTrackActions<T extends Identified>(
  tracks: T[],
  currentId: string | null,
  repeat: RepeatMode,
) {
  return {
    next: nextTarget(tracks, currentId, repeat) !== null,
    previous: currentId !== null,
  };
}

/** What happens when a track plays to its end. */
export function afterEnded<T extends Identified>(
  tracks: T[],
  currentId: string | null,
  repeat: RepeatMode,
): EndedAction<T> {
  if (repeat === "one") return { kind: "restart" };

  const target = following(tracks, currentId, repeat);
  if (!target) return { kind: "stop" };
  // "Repeat all" on a single track comes back to itself: no need to load it again.
  return target.id === currentId ? { kind: "restart" } : { kind: "play", track: target };
}

/**
 * Lets one real end of playback cause at most one automatic advance. The
 * guard is armed by audio actually playing and spent by the advance, so a
 * track that fails to load can't trigger the next one, and the next, in a chain.
 */
export function createAdvanceGuard() {
  let armed = false;
  return {
    onPlaying() {
      armed = true;
    },
    /** True when this end of playback may advance. */
    onEnded(): boolean {
      const allowed = armed;
      armed = false;
      return allowed;
    },
  };
}

/** Keeps a seek inside [0, duration]; with no known duration only the lower bound applies. */
export function clampSeek(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  const upper = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(Math.max(time, 0), upper);
}
