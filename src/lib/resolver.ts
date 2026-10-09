// The app's way to a stream URL. Every resolution is remembered, so the next
// play of that track can skip YouTube while the stream is still good. The
// cache lives only as long as the app is open.

import { createStreamCache } from "./streamCache";
import { resolveAudio, type ResolvedAudio } from "./tauri";

const cache = createStreamCache();

/** Resolves a link through the backend and remembers the result. */
export function resolveStream(url: string): Promise<ResolvedAudio> {
  return resolveAudio(url).then((resolved) => {
    cache.put(resolved);
    return resolved;
  });
}

/** The stream last resolved for a track, if any; the caller decides whether it is still good enough. */
export const cachedStream = (id: string) => cache.peek(id);

/** The stream last resolved for a track, if it will last through `remainingSeconds` of it. */
export const reusableStream = (id: string, remainingSeconds: number) =>
  cache.reusable(id, remainingSeconds, Date.now());

/** Drops what is remembered for a track: it was removed, or its stream just failed. */
export const forgetStream = (id: string) => cache.forget(id);

export const clearStreams = () => cache.clear();
