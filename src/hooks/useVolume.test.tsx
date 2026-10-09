// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVolume } from "./useVolume";

const KEY = "menubar-player:volume";
const stored = () => window.localStorage.getItem(KEY);

function setup() {
  const audio = document.createElement("audio");
  const hook = renderHook(() => useVolume({ current: audio }));
  return { audio, ...hook };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useVolume", () => {
  it("starts at full volume, unmuted, and applies it to the audio element", () => {
    const { audio, result } = setup();

    expect(result.current.volume).toBe(100);
    expect(result.current.muted).toBe(false);
    expect(audio.volume).toBe(1);
    // Nothing changed, so nothing is written.
    vi.advanceTimersByTime(1000);
    expect(stored()).toBeNull();
  });

  it("applies each change at once but saves only 250 ms after the last one", () => {
    const { audio, result } = setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    // A drag: many values in quick succession.
    for (const value of [90, 80, 70, 60]) {
      act(() => result.current.setVolume(value));
      vi.advanceTimersByTime(100);
    }
    expect(audio.volume).toBeCloseTo(0.6);
    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(149);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setItem).toHaveBeenCalledOnce();
    expect(stored()).toBe('{"volume":60,"muted":false}');
  });

  it("remembers the level and the mute across launches", () => {
    const first = setup();
    act(() => first.result.current.setVolume(35));
    act(() => first.result.current.toggleMute());
    vi.advanceTimersByTime(250);
    first.unmount();

    // A fresh mount stands for the next launch.
    const second = setup();
    expect(second.result.current.volume).toBe(35);
    expect(second.result.current.muted).toBe(true);
    expect(second.audio.volume).toBe(0);
  });

  it("silences without losing the level, and brings it back", () => {
    const { audio, result } = setup();
    act(() => result.current.setVolume(35));

    act(() => result.current.toggleMute());
    expect(result.current).toMatchObject({ volume: 35, muted: true });
    expect(audio.volume).toBe(0);

    act(() => result.current.toggleMute());
    expect(result.current).toMatchObject({ volume: 35, muted: false });
    expect(audio.volume).toBeCloseTo(0.35);
  });

  it("stays within 0 and 100", () => {
    const { audio, result } = setup();

    act(() => result.current.setVolume(250));
    expect(result.current.volume).toBe(100);
    expect(audio.volume).toBe(1);

    act(() => result.current.setVolume(-10));
    expect(result.current.volume).toBe(0);
    expect(audio.volume).toBe(0);
  });

  it("keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    const { audio, result } = setup();
    expect(result.current.volume).toBe(100);
    act(() => result.current.setVolume(40));
    vi.advanceTimersByTime(250);
    expect(audio.volume).toBeCloseTo(0.4);
  });
});
