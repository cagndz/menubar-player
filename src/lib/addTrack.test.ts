import { describe, expect, it, vi } from "vitest";
import { addTrack } from "./addTrack";
import type { ResolvedAudio, Track } from "./tauri";

const resolved = (id: string): ResolvedAudio => ({
  id,
  title: `Track ${id}`,
  duration: 100,
  pageUrl: `https://www.youtube.com/watch?v=${id}`,
  streamUrl: `https://stream.example/${id}.m3u8`,
  expiresAt: 1_800_000_000,
});

const saved = (id: string): Track => ({
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Track ${id}`,
  duration: 100,
  position: 0,
  addedAt: "2026-10-08T10:00:00Z",
  lastPlayedAt: "2026-10-08T10:00:00Z",
});

describe("addTrack", () => {
  it("saves a new track from its resolved metadata", async () => {
    const save = vi.fn(() => Promise.resolve(saved("a")));

    const result = await addTrack("https://youtu.be/a", [], { resolve: () => Promise.resolve(resolved("a")), save });

    expect(result).toEqual({ kind: "added", track: saved("a") });
    expect(save).toHaveBeenCalledExactlyOnceWith(resolved("a"));
  });

  it("reports a duplicate without saving it again", async () => {
    const save = vi.fn(() => Promise.resolve(saved("a")));

    const result = await addTrack("https://youtu.be/a", [saved("b"), saved("a")], {
      resolve: () => Promise.resolve(resolved("a")),
      save,
    });

    expect(result).toEqual({ kind: "duplicate", track: saved("a") });
    expect(save).not.toHaveBeenCalled();
  });

  it("returns the failure when the link doesn't resolve", async () => {
    const failure = { code: "not_youtube", detail: null };
    const save = vi.fn(() => Promise.resolve(saved("a")));

    const result = await addTrack("https://example.com", [], { resolve: () => Promise.reject(failure), save });

    expect(result).toEqual({ kind: "error", error: failure });
    expect(save).not.toHaveBeenCalled();
  });

  it("is an error when the track can't be saved", async () => {
    const result = await addTrack("https://youtu.be/a", [], {
      resolve: () => Promise.resolve(resolved("a")),
      save: () => Promise.resolve(null),
    });

    expect(result.kind).toBe("error");
  });
});
