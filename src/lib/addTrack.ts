import type { ResolvedAudio, Track } from "./tauri";

export type AddResult =
  | { kind: "added"; track: Track }
  | { kind: "duplicate"; track: Track }
  | { kind: "error"; error: unknown };

interface AddDependencies {
  resolve: (url: string) => Promise<ResolvedAudio>;
  /** Stores the track and returns it as saved, or null if saving failed. */
  save: (resolved: ResolvedAudio) => Promise<Track | null>;
}

/**
 * Adds a link to the library without playing it. The URL is resolved only
 * for its id, title and duration; the stream URL it comes with is dropped,
 * since it expires and playback resolves a fresh one anyway.
 */
export async function addTrack(url: string, library: Track[], deps: AddDependencies): Promise<AddResult> {
  let resolved: ResolvedAudio;
  try {
    resolved = await deps.resolve(url);
  } catch (error) {
    return { kind: "error", error };
  }

  const existing = library.find((track) => track.id === resolved.id);
  if (existing) return { kind: "duplicate", track: existing };

  const track = await deps.save(resolved);
  return track ? { kind: "added", track } : { kind: "error", error: new Error("saving failed") };
}
