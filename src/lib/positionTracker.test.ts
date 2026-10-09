import { describe, expect, it, vi } from "vitest";
import { trackPosition, type PositionSource } from "./positionTracker";

class FakeAudio extends EventTarget implements PositionSource {
  currentTime = 0;
  readyState = 4;
  paused = false;
  ended = false;
}

function setup(overrides: { trackId?: string | null; settled?: boolean } = {}) {
  const audio = new FakeAudio();
  const save = vi.fn(() => Promise.resolve());
  let clock = 0;
  const tracker = trackPosition(audio, {
    trackId: () => (overrides.trackId === undefined ? "abc" : overrides.trackId),
    isSettled: () => overrides.settled ?? true,
    save,
    intervalMs: 10_000,
    now: () => clock,
  });
  return { audio, save, tracker, advance: (ms: number) => (clock += ms) };
}

describe("trackPosition", () => {
  it("saves position 0 when the audio ends", () => {
    const { audio, save } = setup();
    audio.currentTime = 7649.8;
    audio.ended = true;
    audio.paused = true;

    audio.dispatchEvent(new Event("ended"));

    expect(save).toHaveBeenCalledExactlyOnceWith("abc", 0);
  });

  it("keeps saving 0 after the end, so a later flush can't overwrite it", async () => {
    const { audio, save, tracker } = setup();
    audio.currentTime = 7649.8;
    audio.ended = true;

    await tracker.saveNow();

    expect(save).toHaveBeenCalledExactlyOnceWith("abc", 0);
  });

  it("saves the current position on pause", () => {
    const { audio, save } = setup();
    audio.currentTime = 612.4;
    audio.paused = true;

    audio.dispatchEvent(new Event("pause"));

    expect(save).toHaveBeenCalledExactlyOnceWith("abc", 612.4);
  });

  it("saves while playing only once the interval has passed", () => {
    const { audio, save, advance } = setup();
    audio.currentTime = 5;

    advance(9_999);
    audio.dispatchEvent(new Event("timeupdate"));
    expect(save).not.toHaveBeenCalled();

    advance(1);
    audio.dispatchEvent(new Event("timeupdate"));
    expect(save).toHaveBeenCalledExactlyOnceWith("abc", 5);
  });

  it("saves nothing without a track, without metadata, or before the initial seek", () => {
    const noTrack = setup({ trackId: null });
    noTrack.audio.dispatchEvent(new Event("pause"));
    expect(noTrack.save).not.toHaveBeenCalled();

    const noMetadata = setup();
    noMetadata.audio.readyState = 0;
    noMetadata.audio.dispatchEvent(new Event("pause"));
    expect(noMetadata.save).not.toHaveBeenCalled();

    const unsettled = setup({ settled: false });
    unsettled.audio.dispatchEvent(new Event("ended"));
    expect(unsettled.save).not.toHaveBeenCalled();
  });
});
