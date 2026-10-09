// Stream URLs are valid for hours, but used to be resolved again on every
// play. This keeps the last one resolved for each track, in memory only, so
// playing a track again doesn't cost YouTube another request.

import type { ResolvedAudio } from "./tauri";

/** A cached stream must outlive what is left of the track by this much to be used. */
const REUSE_MARGIN_SECONDS = 5 * 60;

/**
 * Whether a stream resolved earlier can carry a playback that still has
 * `remainingSeconds` of track to go. Without a known expiry or a known
 * amount left, it can't be trusted to.
 */
export function isReusable(resolved: ResolvedAudio, remainingSeconds: number, now: number): boolean {
  if (resolved.expiresAt === null || !Number.isFinite(remainingSeconds) || remainingSeconds < 0) return false;
  const lifeSeconds = resolved.expiresAt - now / 1000;
  return lifeSeconds > remainingSeconds + REUSE_MARGIN_SECONDS;
}

export function createStreamCache() {
  const entries = new Map<string, ResolvedAudio>();

  return {
    /** Remembers a resolution, replacing any earlier one for the same track. */
    put(resolved: ResolvedAudio) {
      // A stream with no known expiry could never be reused, so it isn't kept.
      if (resolved.expiresAt !== null) entries.set(resolved.id, resolved);
    },
    /** The entry for a track, whether or not it would still be usable. */
    peek: (id: string): ResolvedAudio | null => entries.get(id) ?? null,
    /** The entry for a track if it will last for `remainingSeconds` of playback, else null. */
    reusable(id: string, remainingSeconds: number, now: number): ResolvedAudio | null {
      const entry = entries.get(id);
      return entry && isReusable(entry, remainingSeconds, now) ? entry : null;
    },
    forget(id: string) {
      entries.delete(id);
    },
    clear() {
      entries.clear();
    },
  };
}
