import { describe, expect, it } from "vitest";
import {
  clampVolume,
  effectiveVolume,
  parseVolumeState,
  stepVolume,
  toggleMuted,
  volumeLevel,
  withVolume,
} from "./volume";

describe("limits", () => {
  it("keeps the volume between 0 and 100", () => {
    expect(clampVolume(-20)).toBe(0);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(100)).toBe(100);
    expect(clampVolume(140)).toBe(100);
    expect(clampVolume(42.6)).toBe(43);
    expect(clampVolume(NaN)).toBe(100);
  });

  it("moves in steps without leaving the range", () => {
    expect(stepVolume(50, 5)).toBe(55);
    expect(stepVolume(50, -5)).toBe(45);
    expect(stepVolume(98, 5)).toBe(100);
    expect(stepVolume(100, 5)).toBe(100);
    expect(stepVolume(3, -5)).toBe(0);
    expect(stepVolume(0, -5)).toBe(0);
  });
});

describe("muting", () => {
  it("keeps the level, and comes back to it", () => {
    const muted = toggleMuted({ volume: 35, muted: false });
    expect(muted).toEqual({ volume: 35, muted: true });
    expect(effectiveVolume(muted)).toBe(0);

    const unmuted = toggleMuted(muted);
    expect(unmuted).toEqual({ volume: 35, muted: false });
    expect(effectiveVolume(unmuted)).toBeCloseTo(0.35);
  });

  it("is lifted by moving the slider", () => {
    expect(withVolume(60)).toEqual({ volume: 60, muted: false });
    expect(withVolume(140)).toEqual({ volume: 100, muted: false });
  });

  it("goes back to full volume when there was no level to return to", () => {
    expect(toggleMuted({ volume: 0, muted: false })).toEqual({ volume: 100, muted: false });
    expect(toggleMuted({ volume: 0, muted: true })).toEqual({ volume: 100, muted: false });
  });
});

describe("volumeLevel", () => {
  it("tells muted, low and high apart", () => {
    expect(volumeLevel({ volume: 80, muted: true })).toBe("muted");
    expect(volumeLevel({ volume: 0, muted: false })).toBe("muted");
    expect(volumeLevel({ volume: 5, muted: false })).toBe("low");
    expect(volumeLevel({ volume: 49, muted: false })).toBe("low");
    expect(volumeLevel({ volume: 50, muted: false })).toBe("high");
    expect(volumeLevel({ volume: 100, muted: false })).toBe("high");
  });
});

describe("parseVolumeState", () => {
  it("reads a stored state", () => {
    expect(parseVolumeState('{"volume":35,"muted":true}')).toEqual({ volume: 35, muted: true });
  });

  it("defaults to full volume, unmuted, for anything missing or broken", () => {
    const fallback = { volume: 100, muted: false };
    for (const raw of [null, "", "not json", "null", "42", '{"muted":true}', '{"volume":"loud"}']) {
      expect(parseVolumeState(raw)).toEqual(fallback);
    }
  });

  it("clamps a stored level that is out of range", () => {
    expect(parseVolumeState('{"volume":250,"muted":false}')).toEqual({ volume: 100, muted: false });
    expect(parseVolumeState('{"volume":-3}')).toEqual({ volume: 0, muted: false });
  });
});
