import { describe, expect, it } from "vitest";
import type { Track } from "./tauri";
import { trackToStart, trayMenu } from "./trayMenu";

const track = (id: string, lastPlayedAt: string): Track => ({
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: id,
  duration: 100,
  position: 0,
  addedAt: lastPlayedAt,
  lastPlayedAt,
});

const snapshot = { status: "idle", recovering: false, title: null, libraryIsEmpty: false, canNext: false } as const;

describe("trayMenu", () => {
  it("offers Pause while playing and Play otherwise", () => {
    expect(trayMenu({ ...snapshot, status: "playing", title: "A" })).toMatchObject({ playing: true, canToggle: true, title: "A" });
    expect(trayMenu({ ...snapshot, status: "paused", title: "A" })).toMatchObject({ playing: false, canToggle: true });
  });

  it("can start something with nothing loaded only if the library has tracks", () => {
    expect(trayMenu(snapshot).canToggle).toBe(true);
    expect(trayMenu({ ...snapshot, libraryIsEmpty: true }).canToggle).toBe(false);
  });

  it("lets a failed track be tried again", () => {
    expect(trayMenu({ ...snapshot, status: "error" }).canToggle).toBe(true);
  });

  it("offers nothing while a track is loading or reconnecting", () => {
    expect(trayMenu({ ...snapshot, status: "loading", canNext: true })).toMatchObject({ canToggle: false, canNext: false });
    expect(trayMenu({ ...snapshot, status: "playing", recovering: true, canNext: true })).toMatchObject({ canToggle: false, canNext: false });
  });

  it("offers Next when there is a track to go to", () => {
    expect(trayMenu({ ...snapshot, status: "playing", canNext: true }).canNext).toBe(true);
    expect(trayMenu({ ...snapshot, status: "playing" }).canNext).toBe(false);
  });
});

describe("trackToStart", () => {
  const library = [track("new", "2026-10-03T10:00:00Z"), track("played", "2026-10-08T10:00:00Z"), track("old", "2026-10-01T10:00:00Z")];

  it("goes back to the track the player was on", () => {
    expect(trackToStart(library, "old")?.id).toBe("old");
  });

  it("otherwise picks the track played most recently", () => {
    expect(trackToStart(library, null)?.id).toBe("played");
    expect(trackToStart(library, "removed")?.id).toBe("played");
  });

  it("starts a fresh library with its last track", () => {
    const fresh = [track("a", "2026-10-08T10:00:00Z"), track("b", "2026-10-08T10:00:00Z")];
    expect(trackToStart(fresh, null)?.id).toBe("b");
  });

  it("has nothing to start in an empty library", () => {
    expect(trackToStart([], null)).toBeNull();
  });
});
