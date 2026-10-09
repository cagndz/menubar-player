import { describe, expect, it } from "vitest";
import {
  afterEnded,
  availableTrackActions,
  clampSeek,
  createAdvanceGuard,
  nextRepeatMode,
  nextTarget,
  parseRepeatMode,
  previousTarget,
  type RepeatMode,
} from "./mediaNavigation";

const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };
const list = [a, b, c];
const modes: RepeatMode[] = ["off", "all", "one"];

describe("afterEnded", () => {
  it("off: plays the next track, and stops after the last", () => {
    expect(afterEnded(list, "b", "off")).toEqual({ kind: "play", track: c });
    expect(afterEnded(list, "c", "off")).toEqual({ kind: "stop" });
    expect(afterEnded([a], "a", "off")).toEqual({ kind: "stop" });
  });

  it("all: plays the next track, wraps after the last, and repeats a single track", () => {
    expect(afterEnded(list, "b", "all")).toEqual({ kind: "play", track: c });
    expect(afterEnded(list, "c", "all")).toEqual({ kind: "play", track: a });
    expect(afterEnded([a], "a", "all")).toEqual({ kind: "restart" });
  });

  it("one: restarts the same track wherever it is", () => {
    expect(afterEnded(list, "b", "one")).toEqual({ kind: "restart" });
    expect(afterEnded(list, "c", "one")).toEqual({ kind: "restart" });
    expect(afterEnded([a], "a", "one")).toEqual({ kind: "restart" });
  });

  it("stops when the track that ended is no longer in the library", () => {
    expect(afterEnded(list, "gone", "off")).toEqual({ kind: "stop" });
    expect(afterEnded(list, "gone", "all")).toEqual({ kind: "stop" });
  });
});

describe("createAdvanceGuard", () => {
  it("allows one advance per real playback", () => {
    const guard = createAdvanceGuard();
    guard.onPlaying();

    expect(guard.onEnded()).toBe(true);
  });

  it("doesn't cascade when the next track never gets to play", () => {
    const guard = createAdvanceGuard();
    guard.onPlaying();
    expect(guard.onEnded()).toBe(true);

    // The track it advanced to fails to load: nothing plays, so nothing more advances.
    expect(guard.onEnded()).toBe(false);
    expect(guard.onEnded()).toBe(false);
  });

  it("is armed again once the next track plays", () => {
    const guard = createAdvanceGuard();
    guard.onPlaying();
    guard.onEnded();

    guard.onPlaying();
    expect(guard.onEnded()).toBe(true);
  });

  it("ignores an end that no playback preceded", () => {
    expect(createAdvanceGuard().onEnded()).toBe(false);
  });
});

describe("nextTarget", () => {
  it("goes to the following track from the middle, in every mode", () => {
    for (const mode of modes) expect(nextTarget(list, "b", mode)).toBe(c);
  });

  it("from the last track only wraps with repeat all", () => {
    expect(nextTarget(list, "c", "all")).toBe(a);
    expect(nextTarget(list, "c", "off")).toBeNull();
    expect(nextTarget(list, "c", "one")).toBeNull();
  });

  it("ignores repeat one and goes to the adjacent track", () => {
    expect(nextTarget(list, "a", "one")).toBe(b);
  });

  it("goes nowhere with a single track, no track, or an unlisted one", () => {
    for (const mode of modes) {
      expect(nextTarget([a], "a", mode)).toBeNull();
      expect(nextTarget(list, null, mode)).toBeNull();
      expect(nextTarget(list, "gone", mode)).toBeNull();
    }
  });
});

describe("previousTarget", () => {
  it("restarts the current track once it is more than 3 s in, in every mode", () => {
    for (const mode of modes) {
      expect(previousTarget(list, "b", 3.1, mode)).toEqual({ kind: "restart" });
      expect(previousTarget(list, "a", 5400, mode)).toEqual({ kind: "restart" });
    }
  });

  it("goes to the track before within the first 3 s, ignoring repeat one", () => {
    for (const mode of modes) {
      expect(previousTarget(list, "b", 3, mode)).toEqual({ kind: "track", track: a });
      expect(previousTarget(list, "c", 0, mode)).toEqual({ kind: "track", track: b });
    }
  });

  it("from the first track wraps to the last with repeat all", () => {
    expect(previousTarget(list, "a", 1, "all")).toEqual({ kind: "track", track: c });
  });

  it("from the first track restarts it with repeat off or one", () => {
    expect(previousTarget(list, "a", 1, "off")).toEqual({ kind: "restart" });
    expect(previousTarget(list, "a", 1, "one")).toEqual({ kind: "restart" });
  });

  it("restarts with a single track or an unlisted one", () => {
    for (const mode of modes) {
      expect(previousTarget([a], "a", 1, mode)).toEqual({ kind: "restart" });
      expect(previousTarget(list, "gone", 1, mode)).toEqual({ kind: "restart" });
    }
  });
});

describe("availableTrackActions", () => {
  it("offers both in the middle of the library", () => {
    for (const mode of modes) expect(availableTrackActions(list, "b", mode)).toEqual({ next: true, previous: true });
  });

  it("drops next on the last track unless repeat all wraps", () => {
    expect(availableTrackActions(list, "c", "off")).toEqual({ next: false, previous: true });
    expect(availableTrackActions(list, "c", "one")).toEqual({ next: false, previous: true });
    expect(availableTrackActions(list, "c", "all")).toEqual({ next: true, previous: true });
  });

  it("offers only previous with a single track", () => {
    for (const mode of modes) expect(availableTrackActions([a], "a", mode)).toEqual({ next: false, previous: true });
  });

  it("offers neither with nothing loaded", () => {
    for (const mode of modes) expect(availableTrackActions(list, null, mode)).toEqual({ next: false, previous: false });
  });
});

describe("repeat mode", () => {
  it("cycles off -> all -> one -> off", () => {
    expect(nextRepeatMode("off")).toBe("all");
    expect(nextRepeatMode("all")).toBe("one");
    expect(nextRepeatMode("one")).toBe("off");
  });

  it("falls back to all for a missing or unknown stored value", () => {
    expect(parseRepeatMode("one")).toBe("one");
    expect(parseRepeatMode("off")).toBe("off");
    expect(parseRepeatMode(null)).toBe("all");
    expect(parseRepeatMode("shuffle")).toBe("all");
  });
});

describe("clampSeek", () => {
  it("leaves a position inside the track alone", () => {
    expect(clampSeek(600, 7650)).toBe(600);
  });

  it("clamps to the start and to the end", () => {
    expect(clampSeek(-10, 7650)).toBe(0);
    expect(clampSeek(7655, 7650)).toBe(7650);
  });

  it("only applies the lower bound while the duration is unknown", () => {
    expect(clampSeek(600, NaN)).toBe(600);
    expect(clampSeek(-5, Infinity)).toBe(0);
    expect(clampSeek(600, 0)).toBe(600);
  });

  it("treats a non-numeric target as the start", () => {
    expect(clampSeek(NaN, 7650)).toBe(0);
  });
});
