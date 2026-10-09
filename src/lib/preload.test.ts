import { describe, expect, it, vi } from "vitest";
import { createPreloader, isPreloadDue, isUsable, preloadTarget } from "./preload";
import type { ResolvedAudio } from "./tauri";

const track = (id: string) => ({ id, url: `https://www.youtube.com/watch?v=${id}` });
const a = track("a");
const b = track("b");
const c = track("c");
const list = [a, b, c];

const NOW = 1_800_000_000_000;
const resolved = (id: string, expiresInSeconds: number | null = 6 * 3600): ResolvedAudio => ({
  id,
  title: id,
  duration: 600,
  pageUrl: track(id).url,
  streamUrl: `https://stream.example/${id}.m3u8`,
  expiresAt: expiresInSeconds === null ? null : NOW / 1000 + expiresInSeconds,
});

/** A resolver whose promises are settled by hand. */
function manualResolver() {
  const calls: { resolve: (value: ResolvedAudio) => void; reject: (error: unknown) => void }[] = [];
  const resolve = vi.fn(
    (_target: typeof a) => new Promise<ResolvedAudio>((res, rej) => calls.push({ resolve: res, reject: rej })),
  );
  return { resolve, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("preloadTarget", () => {
  it("off: the next track, and nothing after the last", () => {
    expect(preloadTarget(list, "b", "off")).toBe(c);
    expect(preloadTarget(list, "c", "off")).toBeNull();
    expect(preloadTarget([a], "a", "off")).toBeNull();
  });

  it("all: the next track, wrapping after the last; nothing for a single track", () => {
    expect(preloadTarget(list, "b", "all")).toBe(c);
    expect(preloadTarget(list, "c", "all")).toBe(a);
    expect(preloadTarget([a], "a", "all")).toBeNull();
  });

  it("one: nothing, since the same track plays again", () => {
    expect(preloadTarget(list, "b", "one")).toBeNull();
    expect(preloadTarget(list, "c", "one")).toBeNull();
  });
});

describe("isPreloadDue", () => {
  it("waits until 60 s are left on a long track", () => {
    expect(isPreloadDue({ duration: 7650, currentTime: 7589, playingForMs: 60_000 })).toBe(false);
    expect(isPreloadDue({ duration: 7650, currentTime: 7590, playingForMs: 60_000 })).toBe(true);
    expect(isPreloadDue({ duration: 7650, currentTime: 7649, playingForMs: 0 })).toBe(true);
  });

  it("goes by 5 s of steady playback on a track shorter than 2 minutes", () => {
    expect(isPreloadDue({ duration: 90, currentTime: 3, playingForMs: 4_999 })).toBe(false);
    expect(isPreloadDue({ duration: 90, currentTime: 5, playingForMs: 5_000 })).toBe(true);
    // Inside the last minute but not settled yet: still waits.
    expect(isPreloadDue({ duration: 90, currentTime: 60, playingForMs: 1_000 })).toBe(false);
  });

  it("never fires while the duration is unknown", () => {
    expect(isPreloadDue({ duration: NaN, currentTime: 10, playingForMs: 60_000 })).toBe(false);
    expect(isPreloadDue({ duration: Infinity, currentTime: 10, playingForMs: 60_000 })).toBe(false);
  });
});

describe("isUsable", () => {
  it("needs a known expiry more than 60 s away", () => {
    expect(isUsable(resolved("b", 3600), NOW)).toBe(true);
    expect(isUsable(resolved("b", 60), NOW)).toBe(true);
    expect(isUsable(resolved("b", 59), NOW)).toBe(false);
    expect(isUsable(resolved("b", -10), NOW)).toBe(false);
    expect(isUsable(resolved("b", null), NOW)).toBe(false);
  });
});

describe("createPreloader", () => {
  const due = (currentId: string, target: typeof a | null) => ({ currentId, target, due: true });

  it("resolves the target once it is due, and only once", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });

    preloader.update({ currentId: "a", target: b, due: false });
    expect(resolve).not.toHaveBeenCalled();

    preloader.update(due("a", b));
    preloader.update(due("a", b));
    expect(resolve).toHaveBeenCalledExactlyOnceWith(b);
    expect(preloader.state()).toBe("resolving");

    calls[0].resolve(resolved("b"));
    await flush();
    preloader.update(due("a", b));
    expect(preloader.state()).toBe("ready");
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("hands over a ready entry for its pair and empties the slot", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });
    preloader.update(due("a", b));
    calls[0].resolve(resolved("b"));
    await flush();

    expect(preloader.take("a", "b", NOW)).toEqual({ kind: "ready", resolved: resolved("b") });
    expect(preloader.state()).toBe("empty");
    expect(preloader.take("a", "b", NOW)).toBeNull();
  });

  it("hands over the same promise while still resolving, without resolving again", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });
    preloader.update(due("a", b));

    const taken = preloader.take("a", "b", NOW);
    expect(taken?.kind).toBe("pending");
    expect(resolve).toHaveBeenCalledOnce();

    calls[0].resolve(resolved("b"));
    expect(taken?.kind === "pending" && (await taken.promise)).toEqual(resolved("b"));
  });

  it("gives nothing for another pair", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });
    preloader.update(due("a", b));
    calls[0].resolve(resolved("b"));
    await flush();

    expect(preloader.take("a", "c", NOW)).toBeNull();
    expect(preloader.take("c", "b", NOW)).toBeNull();
    expect(preloader.state()).toBe("ready");
  });

  it("drops the entry when the current track, the target, the mode or the library change it", async () => {
    for (const change of [
      { currentId: "c", target: a }, // another track is playing now
      { currentId: "a", target: c }, // the library changed what follows
      { currentId: "a", target: null }, // repeat one, or the target was removed and nothing follows
    ]) {
      const { resolve, calls } = manualResolver();
      const preloader = createPreloader({ resolve });
      preloader.update(due("a", b));
      calls[0].resolve(resolved("b"));
      await flush();

      preloader.update({ ...change, due: false });
      expect(preloader.state()).toBe("empty");
      expect(preloader.take("a", "b", NOW)).toBeNull();
    }
  });

  it("keeps the entry when the library changes but the same track still follows", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });
    preloader.update(due("a", b));
    calls[0].resolve(resolved("b"));
    await flush();

    // e.g. a track was added elsewhere in the list.
    preloader.update(due("a", b));
    expect(preloader.state()).toBe("ready");
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("recalculates when the target is removed and when the removal is undone", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });
    preloader.update(due("a", preloadTarget(list, "a", "all")));
    calls[0].resolve(resolved("b"));
    await flush();

    // "b" is removed: "c" follows "a" now.
    preloader.update(due("a", preloadTarget([a, c], "a", "all")));
    expect(resolve).toHaveBeenLastCalledWith(c);
    expect(preloader.take("a", "b", NOW)).toBeNull();

    // Undo: "b" follows again, and is resolved afresh.
    preloader.update(due("a", preloadTarget(list, "a", "all")));
    expect(resolve).toHaveBeenLastCalledWith(b);
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("ignores a resolution that arrives after its pair was dropped", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });
    preloader.update(due("a", b));
    preloader.update(due("a", c));

    calls[0].resolve(resolved("b"));
    await flush();
    expect(preloader.state()).toBe("resolving");
    expect(preloader.take("a", "b", NOW)).toBeNull();
  });

  it("refuses an entry that is about to expire", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });
    preloader.update(due("a", b));
    calls[0].resolve(resolved("b", 30));
    await flush();

    expect(preloader.take("a", "b", NOW)).toBeNull();
    expect(preloader.state()).toBe("empty");
  });

  it("stays quiet when the resolution fails: nothing to take, and no retry for that pair", async () => {
    const { resolve, calls } = manualResolver();
    const preloader = createPreloader({ resolve });
    preloader.update(due("a", b));
    calls[0].reject({ code: "ytdlp_failed", detail: null });
    await flush();

    expect(preloader.state()).toBe("failed");
    preloader.update(due("a", b));
    expect(resolve).toHaveBeenCalledOnce();
    expect(preloader.take("a", "b", NOW)).toBeNull();
  });
});
