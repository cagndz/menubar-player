import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canReachYoutube,
  createStallDetector,
  createStallWatch,
  isExpiring,
  needsStallWatch,
} from "./recovery";

describe("createStallDetector", () => {
  const stalled = (now: number, overrides = {}) => ({ now, wantsPlaying: true, readyState: 2, currentTime: 100, ...overrides });

  it("fires once playback has been stuck short of data for the threshold", () => {
    const detector = createStallDetector(10_000);

    expect(detector.observe(stalled(0))).toBe(false);
    expect(detector.observe(stalled(9_999))).toBe(false);
    expect(detector.observe(stalled(10_000))).toBe(true);
  });

  it("measures from timestamps, however far apart the samples arrive", () => {
    const detector = createStallDetector(10_000);

    expect(detector.observe(stalled(0))).toBe(false);
    expect(detector.observe(stalled(45_000))).toBe(true);
  });

  it("starts over when the position advances", () => {
    const detector = createStallDetector(10_000);

    detector.observe(stalled(0));
    expect(detector.observe(stalled(8_000, { currentTime: 101 }))).toBe(false);
    expect(detector.observe(stalled(12_000, { currentTime: 101 }))).toBe(false);
    expect(detector.observe(stalled(21_999, { currentTime: 101 }))).toBe(false);
    expect(detector.observe(stalled(22_000, { currentTime: 101 }))).toBe(true);
  });

  it("never fires while paused or while there is data to play", () => {
    const paused = createStallDetector(10_000);
    paused.observe(stalled(0, { wantsPlaying: false }));
    expect(paused.observe(stalled(60_000, { wantsPlaying: false }))).toBe(false);

    const buffered = createStallDetector(10_000);
    buffered.observe(stalled(0, { readyState: 4 }));
    expect(buffered.observe(stalled(60_000, { readyState: 4 }))).toBe(false);
  });

  it("forgets a stall that cleared before the threshold", () => {
    const detector = createStallDetector(10_000);

    detector.observe(stalled(0));
    detector.observe(stalled(5_000, { readyState: 4 }));
    expect(detector.observe(stalled(11_000))).toBe(false);
    expect(detector.observe(stalled(21_000))).toBe(true);
  });

  it("starts over after reset", () => {
    const detector = createStallDetector(10_000);

    detector.observe(stalled(0));
    detector.reset();
    expect(detector.observe(stalled(10_000))).toBe(false);
  });
});

describe("canReachYoutube", () => {
  it("is false without probing when the system is offline", async () => {
    const probe = vi.fn(() => Promise.resolve(true));

    expect(await canReachYoutube(false, probe)).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it("follows the probe when the system says it is online", async () => {
    expect(await canReachYoutube(true, () => Promise.resolve(true))).toBe(true);
    expect(await canReachYoutube(true, () => Promise.resolve(false))).toBe(false);
  });

  it("treats a failing probe as unreachable", async () => {
    expect(await canReachYoutube(true, () => Promise.reject(new Error("boom")))).toBe(false);
  });
});

describe("isExpiring", () => {
  const expiresAt = 1_800_000_000; // seconds
  const at = (secondsBeforeExpiry: number) => (expiresAt - secondsBeforeExpiry) * 1000;

  it("is false while more than the margin remains", () => {
    expect(isExpiring(expiresAt, at(3600))).toBe(false);
    expect(isExpiring(expiresAt, at(60))).toBe(false);
  });

  it("is true inside the last 60 seconds and after expiry", () => {
    expect(isExpiring(expiresAt, at(59))).toBe(true);
    expect(isExpiring(expiresAt, at(0))).toBe(true);
    expect(isExpiring(expiresAt, at(-7200))).toBe(true);
  });

  it("is false when the expiry is unknown", () => {
    expect(isExpiring(null, at(-7200))).toBe(false);
  });
});

describe("needsStallWatch", () => {
  const stalled = { active: true, wantsPlaying: true, recovering: false, readyState: 2 };

  it("is needed while playback is wanted and has no data to advance with", () => {
    expect(needsStallWatch(stalled)).toBe(true);
    expect(needsStallWatch({ ...stalled, readyState: 0 })).toBe(true);
  });

  it("isn't needed in pause or with nothing loaded", () => {
    expect(needsStallWatch({ ...stalled, wantsPlaying: false })).toBe(false);
    expect(needsStallWatch({ ...stalled, active: false })).toBe(false);
  });

  it("isn't needed while playing normally or already recovering", () => {
    expect(needsStallWatch({ ...stalled, readyState: 3 })).toBe(false);
    expect(needsStallWatch({ ...stalled, readyState: 4 })).toBe(false);
    expect(needsStallWatch({ ...stalled, recovering: true })).toBe(false);
  });
});

describe("createStallWatch", () => {
  afterEach(() => vi.useRealTimers());

  it("ticks every 2 s while it is needed, and holds no timer otherwise", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const watch = createStallWatch({ onTick });
    expect(vi.getTimerCount()).toBe(0);

    watch.sync(true);
    expect(watch.isRunning()).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4_000);
    expect(onTick).toHaveBeenCalledTimes(3);

    watch.sync(false);
    expect(watch.isRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it("keeps a single timer however often it is told it is needed", () => {
    vi.useFakeTimers();
    const watch = createStallWatch({ onTick: vi.fn() });

    watch.sync(true);
    watch.sync(true);
    watch.sync(true);
    expect(vi.getTimerCount()).toBe(1);

    watch.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the stall detector fire at its 10 s threshold with no media events at all", () => {
    vi.useFakeTimers();
    const detector = createStallDetector(10_000);
    let fired = 0;
    const watch = createStallWatch({
      onTick: () => {
        if (detector.observe({ now: Date.now(), wantsPlaying: true, readyState: 0, currentTime: 42 })) fired++;
      },
    });

    watch.sync(true);
    vi.advanceTimersByTime(11_999);
    expect(fired).toBe(0);
    vi.advanceTimersByTime(1);
    // First sample at 2 s, threshold reached 10 s later.
    expect(fired).toBe(1);
  });
});

