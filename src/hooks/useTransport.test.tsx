// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAudio, Track } from "../lib/tauri";

const backend = vi.hoisted(() => ({ resolveAudio: vi.fn() }));
vi.mock("../lib/tauri", () => ({ resolveAudio: backend.resolveAudio, debugLog: () => {} }));

import { useTransport } from "./useTransport";

const track = (id: string): Track => ({
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: id,
  duration: 600,
  position: 0,
  addedAt: "2026-10-08T10:00:00Z",
  lastPlayedAt: "2026-10-08T10:00:00Z",
});

afterEach(() => {
  cleanup();
  backend.resolveAudio.mockReset();
});

describe("useTransport preloading", () => {
  it("is driven by the audio element and refs, not by rendered state", () => {
    backend.resolveAudio.mockReturnValue(new Promise<ResolvedAudio>(() => {}));
    const audio = document.createElement("audio");
    let currentTime = 100;
    Object.defineProperty(audio, "duration", { get: () => 600 });
    Object.defineProperty(audio, "currentTime", { get: () => currentTime });

    // The rendered state says nothing is loaded and never changes, as it will
    // while the popover is closed; only the live getter knows "a" is playing.
    const { rerender } = renderHook(() =>
      useTransport({
        audioRef: { current: audio },
        tracks: [track("a"), track("b")],
        trackId: null,
        getTrackId: () => "a",
        repeat: "all",
        load: vi.fn(),
        playResolved: vi.fn(),
        seek: vi.fn(),
        restart: vi.fn(),
      }),
    );
    expect(backend.resolveAudio).not.toHaveBeenCalled();

    // Playback reaches the last minute. No act(), no re-render: just the media event.
    audio.dispatchEvent(new Event("timeupdate"));
    expect(backend.resolveAudio).not.toHaveBeenCalled();
    currentTime = 570;
    audio.dispatchEvent(new Event("timeupdate"));
    expect(backend.resolveAudio).toHaveBeenCalledExactlyOnceWith(track("b").url);

    act(() => rerender());
    audio.dispatchEvent(new Event("timeupdate"));
    expect(backend.resolveAudio).toHaveBeenCalledOnce();
  });

  it("doesn't preload in repeat one", () => {
    backend.resolveAudio.mockReturnValue(new Promise<ResolvedAudio>(() => {}));
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "duration", { get: () => 600 });
    Object.defineProperty(audio, "currentTime", { get: () => 570 });

    renderHook(() =>
      useTransport({
        audioRef: { current: audio },
        tracks: [track("a"), track("b")],
        trackId: "a",
        getTrackId: () => "a",
        repeat: "one",
        load: vi.fn(),
        playResolved: vi.fn(),
        seek: vi.fn(),
        restart: vi.fn(),
      }),
    );

    audio.dispatchEvent(new Event("timeupdate"));
    expect(backend.resolveAudio).not.toHaveBeenCalled();
  });
});
