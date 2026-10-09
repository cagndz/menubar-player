import { describe, expect, it } from "vitest";
import { createStreamCache, isReusable } from "./streamCache";
import type { ResolvedAudio } from "./tauri";

const NOW = 1_800_000_000_000;
const stream = (id: string, lifeSeconds: number | null, duration = 600): ResolvedAudio => ({
  id,
  title: id,
  duration,
  pageUrl: `https://www.youtube.com/watch?v=${id}`,
  streamUrl: `https://stream.example/${id}-${lifeSeconds}.m3u8`,
  expiresAt: lifeSeconds === null ? null : NOW / 1000 + lifeSeconds,
});

describe("isReusable", () => {
  it("needs the stream to outlive what is left of the track by more than 5 minutes", () => {
    // 600 s left to play: 900 s of life is exactly the margin, one more second is enough.
    expect(isReusable(stream("a", 900), 600, NOW)).toBe(false);
    expect(isReusable(stream("a", 901), 600, NOW)).toBe(true);
    expect(isReusable(stream("a", 6 * 3600), 600, NOW)).toBe(true);
  });

  it("goes by what is left of the track, not by its full length", () => {
    const twoHours = stream("a", 3600, 7200);
    expect(isReusable(twoHours, 7200, NOW)).toBe(false);
    expect(isReusable(twoHours, 1800, NOW)).toBe(true);
  });

  it("refuses an expired stream", () => {
    expect(isReusable(stream("a", -10), 0, NOW)).toBe(false);
    expect(isReusable(stream("a", 200), 0, NOW)).toBe(false);
  });

  it("refuses when the expiry or the amount left is unknown", () => {
    expect(isReusable(stream("a", null), 10, NOW)).toBe(false);
    expect(isReusable(stream("a", 6 * 3600), NaN, NOW)).toBe(false);
    expect(isReusable(stream("a", 6 * 3600), -5, NOW)).toBe(false);
  });
});

describe("createStreamCache", () => {
  it("hands back the stream resolved for a track while it is good", () => {
    const cache = createStreamCache();
    cache.put(stream("a", 6 * 3600));

    expect(cache.reusable("a", 600, NOW)).toEqual(stream("a", 6 * 3600));
    expect(cache.reusable("b", 600, NOW)).toBeNull();
    // Using it doesn't use it up: the track can be played again and again.
    expect(cache.reusable("a", 600, NOW)).not.toBeNull();
  });

  it("stops handing it back once it gets too close to expiring", () => {
    const cache = createStreamCache();
    cache.put(stream("a", 6 * 3600));
    const later = NOW + (6 * 3600 - 800) * 1000;

    expect(cache.reusable("a", 600, later)).toBeNull();
    expect(cache.reusable("a", 100, later)).not.toBeNull();
    expect(cache.reusable("a", 100, NOW + 6 * 3600 * 1000)).toBeNull();
  });

  it("keeps the newest resolution for a track", () => {
    const cache = createStreamCache();
    cache.put(stream("a", 1000));
    cache.put(stream("a", 6 * 3600));

    expect(cache.peek("a")).toEqual(stream("a", 6 * 3600));
  });

  it("forgets a track when told to, and everything on clear", () => {
    const cache = createStreamCache();
    cache.put(stream("a", 6 * 3600));
    cache.put(stream("b", 6 * 3600));

    cache.forget("a");
    expect(cache.peek("a")).toBeNull();
    expect(cache.peek("b")).not.toBeNull();

    cache.clear();
    expect(cache.peek("b")).toBeNull();
  });

  it("doesn't keep a stream with no known expiry", () => {
    const cache = createStreamCache();
    cache.put(stream("a", null));

    expect(cache.peek("a")).toBeNull();
  });
});
