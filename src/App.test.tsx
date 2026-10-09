// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAudio, Track } from "./lib/tauri";

const backend = vi.hoisted(() => ({
  library: [] as Track[],
  resolveAudio: vi.fn(),
  upsertTrack: vi.fn(),
  setTrayState: vi.fn((_playing: boolean) => Promise.resolve()),
  setTrayMenu: vi.fn((_menu: unknown) => Promise.resolve()),
  showPopover: vi.fn(() => Promise.resolve()),
  trayAction: (_action: "toggle" | "next") => {},
  setTrackPosition: vi.fn((_id: string, _position: number) => Promise.resolve()),
  deleteTrack: vi.fn((_id: string) => Promise.resolve([] as Track[])),
  restoreTrack: vi.fn((_track: Track) => Promise.resolve([] as Track[])),
}));

vi.mock("./lib/tauri", () => ({
  resolveAudio: backend.resolveAudio,
  upsertTrack: backend.upsertTrack,
  listTracks: () => Promise.resolve(backend.library),
  setTrackPosition: backend.setTrackPosition,
  deleteTrack: backend.deleteTrack,
  restoreTrack: backend.restoreTrack,
  checkConnectivity: () => Promise.resolve(true),
  hidePopover: () => Promise.resolve(),
  setTrayState: backend.setTrayState,
  setTrayMenu: backend.setTrayMenu,
  onTrayAction: (handler: (action: "toggle" | "next") => void) => {
    backend.trayAction = handler;
    return () => {};
  },
  showPopover: backend.showPopover,
  quitApp: () => Promise.resolve(),
  onQuitRequested: () => () => {},
  debugLog: () => {},
}));

import App from "./App";
import { clearStreams } from "./lib/resolver";
import { tabStops } from "./lib/focus";

const resolved = (id: string): ResolvedAudio => ({
  id,
  title: `Track ${id}`,
  duration: 100,
  pageUrl: `https://www.youtube.com/watch?v=${id}`,
  streamUrl: `https://stream.example/${id}.m3u8`,
  expiresAt: null,
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

const media = {
  play: vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve()),
  pause: vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {}),
  load: vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {}),
};

async function renderApp(library: Track[] = []) {
  backend.library = library;
  render(<App />);
  // The library is read on mount; wait for it so the list is in its final state.
  await screen.findByText(library.length ? `Track ${library[0].id}` : /Your library is empty/);
  const input = screen.getByRole("textbox", { name: "YouTube URL" }) as HTMLInputElement;
  return { input, addButton: screen.getByRole("button", { name: "Add" }) as HTMLButtonElement };
}

async function add(input: HTMLInputElement, url: string) {
  fireEvent.change(input, { target: { value: url } });
  await act(async () => {
    fireEvent.submit(input.closest("form")!);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  clearStreams();
  backend.resolveAudio.mockReset();
  backend.upsertTrack.mockReset();
  for (const spy of Object.values(media)) spy.mockClear();
});

afterEach(cleanup);

describe("adding a track", () => {
  it("saves it without touching the player, then clears and refocuses the field", async () => {
    backend.resolveAudio.mockResolvedValue(resolved("a"));
    backend.upsertTrack.mockResolvedValue([saved("a")]);
    const { input } = await renderApp();

    await add(input, "https://youtu.be/a");

    expect(backend.upsertTrack).toHaveBeenCalledExactlyOnceWith(resolved("a"));
    expect(await screen.findByText("Track a")).toBeTruthy();
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);

    const audio = document.querySelector("audio")!;
    expect(media.play).not.toHaveBeenCalled();
    expect(media.load).not.toHaveBeenCalled();
    expect(audio.getAttribute("src")).toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("is disabled while the field is empty and while resolving", async () => {
    let finish!: (value: ResolvedAudio) => void;
    backend.resolveAudio.mockReturnValue(new Promise<ResolvedAudio>((resolve) => (finish = resolve)));
    backend.upsertTrack.mockResolvedValue([saved("a")]);
    const { input, addButton } = await renderApp();

    expect(addButton.disabled).toBe(true);

    await add(input, "https://youtu.be/a");
    const busy = screen.getByRole("button", { name: "Adding…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);

    await act(async () => finish(resolved("a")));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeTruthy());
  });

  it("doesn't duplicate a track already in the library: it says so and focuses its row", async () => {
    backend.resolveAudio.mockResolvedValue(resolved("b"));
    const { input } = await renderApp([saved("a"), saved("b")]);

    await add(input, "https://youtu.be/b");

    expect(backend.upsertTrack).not.toHaveBeenCalled();
    expect(screen.getByText("Already in your library")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getAllByRole("listitem")[1]);
    expect(media.play).not.toHaveBeenCalled();
  });

  it("keeps the text and shows the error when the link can't be added", async () => {
    backend.resolveAudio.mockRejectedValue({ code: "not_youtube", detail: null });
    const { input } = await renderApp();

    await add(input, "https://example.com/video");

    expect(input.value).toBe("https://example.com/video");
    expect(screen.getByRole("alert").textContent).toBe("That isn't a YouTube link. Paste a YouTube video URL.");
    expect(backend.upsertTrack).not.toHaveBeenCalled();
  });

  it("dismisses the outcome of the last add once the text changes", async () => {
    backend.resolveAudio.mockRejectedValue({ code: "not_youtube", detail: null });
    const { input } = await renderApp();

    await add(input, "https://example.com/video");
    fireEvent.change(input, { target: { value: "https://youtu.be/a" } });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("menu bar icon", () => {
  it("shows the pause sign until something plays, level bars while it does, and the pause sign again in pause", async () => {
    backend.setTrayState.mockClear();
    backend.resolveAudio.mockResolvedValue(resolved("a"));
    backend.upsertTrack.mockResolvedValue([saved("a")]);
    await renderApp([saved("a")]);
    expect(backend.setTrayState.mock.calls).toEqual([[false]]);

    const audio = document.querySelector("audio")!;
    await act(async () => {
      fireEvent.click(screen.getByRole("listitem"));
    });
    // Loading isn't playing yet.
    expect(backend.setTrayState).toHaveBeenLastCalledWith(false);

    await act(async () => void audio.dispatchEvent(new Event("playing")));
    expect(backend.setTrayState).toHaveBeenLastCalledWith(true);

    Object.defineProperty(audio, "readyState", { configurable: true, get: () => 4 });
    await act(async () => void audio.dispatchEvent(new Event("pause")));
    expect(backend.setTrayState).toHaveBeenLastCalledWith(false);
  });
});

describe("playing from the library", () => {
  it("starts from the row, not from the field", async () => {
    backend.resolveAudio.mockResolvedValue(resolved("a"));
    backend.upsertTrack.mockResolvedValue([saved("a")]);
    await renderApp([saved("a")]);

    await act(async () => {
      fireEvent.click(screen.getByRole("listitem"));
    });

    expect(media.play).toHaveBeenCalledOnce();
    expect(document.querySelector("audio")!.getAttribute("src")).toBe("https://stream.example/a.m3u8");
  });
});

describe("preloading the next track", () => {
  const SIX_HOURS = 6 * 3600;
  const fresh = (id: string): ResolvedAudio => ({ ...resolved(id), expiresAt: Date.now() / 1000 + SIX_HOURS });

  /** jsdom's media element has no playback; this stands in for the properties the app reads. */
  function fakeMedia(audio: HTMLAudioElement) {
    const media = { duration: NaN, currentTime: 0, paused: true, ended: false, readyState: 4, error: null as unknown };
    for (const key of Object.keys(media) as (keyof typeof media)[]) {
      Object.defineProperty(audio, key, {
        configurable: true,
        get: () => media[key],
        set: (value) => {
          (media as Record<string, unknown>)[key] = value;
        },
      });
    }
    return media;
  }

  /** How many times the next track ("b") has been resolved. */
  const resolutionsOfNext = () =>
    backend.resolveAudio.mock.calls.filter(([url]) => url === saved("b").url).length;

  const fire = (audio: HTMLAudioElement, type: string) => act(async () => void audio.dispatchEvent(new Event(type)));

  /** Plays track "a" of the library [a, b] up to its last minute, which is when "b" gets preloaded. */
  async function playUntilPreload() {
    await renderApp([saved("a"), saved("b")]);
    const audio = document.querySelector("audio")!;
    const media = fakeMedia(audio);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("listitem")[0]);
    });
    media.paused = false;
    await fire(audio, "playing");

    media.duration = 600;
    media.currentTime = 100;
    await fire(audio, "timeupdate");
    expect(backend.resolveAudio).toHaveBeenCalledTimes(1);

    media.currentTime = 545;
    await fire(audio, "timeupdate");
    await fire(audio, "timeupdate");
    return { audio, media };
  }

  async function endTrack(audio: HTMLAudioElement, media: ReturnType<typeof fakeMedia>) {
    media.paused = true;
    media.ended = true;
    await fire(audio, "ended");
  }

  it("resolves the next track once, in the last minute, driven by timeupdate", async () => {
    backend.upsertTrack.mockResolvedValue([saved("a"), saved("b")]);
    backend.resolveAudio.mockImplementation((url: string) => Promise.resolve(fresh(url.endsWith("=a") ? "a" : "b")));

    await playUntilPreload();

    expect(backend.resolveAudio).toHaveBeenCalledTimes(2);
    expect(backend.resolveAudio).toHaveBeenLastCalledWith(saved("b").url);
  });

  it("at the end, switches to the preloaded stream without resolving again or showing a loading state", async () => {
    backend.upsertTrack.mockResolvedValue([saved("a"), saved("b")]);
    backend.resolveAudio.mockImplementation((url: string) => Promise.resolve(fresh(url.endsWith("=a") ? "a" : "b")));
    const { audio, media } = await playUntilPreload();

    await endTrack(audio, media);

    expect(audio.getAttribute("src")).toBe("https://stream.example/b.m3u8");
    expect(resolutionsOfNext()).toBe(1);
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("at the end, waits for a preload still in flight instead of resolving again", async () => {
    backend.upsertTrack.mockResolvedValue([saved("a"), saved("b")]);
    let finishPreload!: (value: ResolvedAudio) => void;
    backend.resolveAudio.mockImplementation((url: string) =>
      url.endsWith("=a")
        ? Promise.resolve(fresh("a"))
        : new Promise<ResolvedAudio>((resolve) => (finishPreload = resolve)),
    );
    const { audio, media } = await playUntilPreload();

    await endTrack(audio, media);
    expect(resolutionsOfNext()).toBe(1);
    expect(audio.getAttribute("src")).toBeNull();

    await act(async () => finishPreload(fresh("b")));
    await waitFor(() => expect(audio.getAttribute("src")).toBe("https://stream.example/b.m3u8"));
    expect(resolutionsOfNext()).toBe(1);
  });

  it("sends a preloaded stream that fails to load through the usual recovery, capped at two attempts", async () => {
    backend.upsertTrack.mockResolvedValue([saved("a"), saved("b")]);
    let resolutionsOfB = 0;
    backend.resolveAudio.mockImplementation((url: string) => {
      if (url.endsWith("=a")) return Promise.resolve(fresh("a"));
      // The preload succeeds; every resolution after it fails.
      return ++resolutionsOfB === 1 ? Promise.resolve(fresh("b")) : Promise.reject({ code: "ytdlp_failed", detail: null });
    });
    const { audio, media } = await playUntilPreload();
    await endTrack(audio, media);
    expect(audio.getAttribute("src")).toBe("https://stream.example/b.m3u8");

    media.ended = false;
    media.error = { code: 4, message: "" };
    await fire(audio, "error");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't resume this track."));
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    // One preload plus exactly two recovery attempts.
    expect(resolutionsOfB).toBe(3);
  });

  it("stops at once on a rate limit during recovery, without spending or repeating attempts", async () => {
    backend.upsertTrack.mockResolvedValue([saved("a"), saved("b")]);
    let resolutionsOfA = 0;
    backend.resolveAudio.mockImplementation((url: string) => {
      if (!url.endsWith("=a")) return new Promise<ResolvedAudio>(() => {});
      return ++resolutionsOfA === 1 ? Promise.resolve(fresh("a")) : Promise.reject({ code: "rate_limited", detail: null });
    });
    await renderApp([saved("a"), saved("b")]);
    const audio = document.querySelector("audio")!;
    const media = fakeMedia(audio);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("listitem")[0]);
    });
    media.paused = false;
    await fire(audio, "playing");

    media.error = { code: 2, message: "" };
    await fire(audio, "error");

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("YouTube is limiting requests right now. Try again in a while."),
    );
    // The first play plus a single recovery attempt: the second one never happens.
    expect(resolutionsOfA).toBe(2);
  });

  it("falls back to resolving at the end when the preload failed, without having shown an error", async () => {
    backend.upsertTrack.mockResolvedValue([saved("a"), saved("b")]);
    let resolutionsOfB = 0;
    backend.resolveAudio.mockImplementation((url: string) => {
      if (url.endsWith("=a")) return Promise.resolve(fresh("a"));
      return ++resolutionsOfB === 1 ? Promise.reject({ code: "ytdlp_failed", detail: null }) : Promise.resolve(fresh("b"));
    });
    const { audio, media } = await playUntilPreload();
    expect(screen.queryByRole("alert")).toBeNull();

    await endTrack(audio, media);

    await waitFor(() => expect(audio.getAttribute("src")).toBe("https://stream.example/b.m3u8"));
    expect(resolutionsOfB).toBe(2);
  });
});

describe("rendering while playing", () => {
  let visibility: DocumentVisibilityState = "visible";
  let commits = 0;

  beforeEach(() => {
    visibility = "visible";
    commits = 0;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });

  function fakeMedia(audio: HTMLAudioElement) {
    const media = { duration: 600, currentTime: 0, paused: false, ended: false, readyState: 4, error: null as unknown };
    for (const key of Object.keys(media) as (keyof typeof media)[]) {
      Object.defineProperty(audio, key, { configurable: true, get: () => media[key] });
    }
    return media;
  }

  /** Renders the app with track "a" of [a, b] playing, counting every React commit from then on. */
  async function playCounting() {
    backend.library = [saved("a"), saved("b")];
    backend.upsertTrack.mockResolvedValue([saved("a"), saved("b")]);
    backend.resolveAudio.mockImplementation((url: string) => Promise.resolve(resolved(url.endsWith("=a") ? "a" : "b")));
    render(
      <Profiler id="app" onRender={() => commits++}>
        <App />
      </Profiler>,
    );
    await screen.findByText("Track a");
    const audio = document.querySelector("audio")!;
    const media = fakeMedia(audio);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("listitem")[0]);
    });
    await act(async () => void audio.dispatchEvent(new Event("playing")));
    commits = 0;

    const tick = (time: number) =>
      act(async () => {
        media.currentTime = time;
        audio.dispatchEvent(new Event("timeupdate"));
      });
    return { audio, tick };
  }

  const shownTime = () => document.querySelector('[data-slot="current-time"]')!.textContent;

  it("updates the time at most once per displayed second while the popover is visible", async () => {
    const { tick } = await playCounting();

    await tick(10.1);
    expect(commits).toBe(1);
    expect(shownTime()).toBe("0:10");

    await tick(10.35);
    await tick(10.6);
    await tick(10.85);
    expect(commits).toBe(1);

    await tick(11.1);
    expect(commits).toBe(2);
    expect(shownTime()).toBe("0:11");
  });

  it("renders nothing for playback time while the popover is closed, and catches up when it opens", async () => {
    const { tick } = await playCounting();
    await tick(10.1);
    commits = 0;

    visibility = "hidden";
    for (const time of [11.2, 12.4, 13.6, 30.1, 95.7]) await tick(time);
    expect(commits).toBe(0);
    expect(shownTime()).toBe("0:10");

    visibility = "visible";
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(commits).toBe(1);
    expect(shownTime()).toBe("1:35");
  });

  it("still preloads the next track from timeupdate while the popover is closed", async () => {
    const { tick } = await playCounting();
    visibility = "hidden";
    backend.resolveAudio.mockClear();

    await tick(545);

    expect(backend.resolveAudio).toHaveBeenCalledExactlyOnceWith(saved("b").url);
  });

  it("doesn't re-render when a position is saved", async () => {
    const { audio, tick } = await playCounting();
    visibility = "hidden";
    await tick(50);
    commits = 0;

    // Pausing saves the position right away.
    await act(async () => void audio.dispatchEvent(new Event("pause")));
    // One commit for the paused state itself; none for the save.
    expect(commits).toBe(1);
  });
});

describe("saved positions come from disk, not from the list held in React", () => {
  // Stands in for sessions.json: the only place positions are kept up to date.
  let disk: Track[] = [];
  const onDisk = (id: string) => disk.find((track) => track.id === id)!;

  const read = () => disk.map((track) => ({ ...track }));
  // Every read of the library, list_tracks included, sees what was last written.
  const write = (next: Track[]) => {
    disk = next;
    backend.library = read();
  };

  beforeEach(() => {
    write([saved("a"), saved("b")]);
    backend.resolveAudio.mockImplementation((url: string) => Promise.resolve(resolved(url.endsWith("=a") ? "a" : "b")));
    backend.upsertTrack.mockImplementation(() => Promise.resolve(read()));
    backend.setTrackPosition.mockImplementation((id: string, position: number) => {
      write(disk.map((track) => (track.id === id ? { ...track, position } : track)));
      return Promise.resolve();
    });
    backend.deleteTrack.mockImplementation((id: string) => {
      write(disk.filter((track) => track.id !== id));
      return Promise.resolve(read());
    });
    backend.restoreTrack.mockImplementation((track: Track) => {
      write([track, ...disk]);
      return Promise.resolve(read());
    });
  });

  function fakeMedia(audio: HTMLAudioElement) {
    const media = { duration: 600, currentTime: 0, paused: false, ended: false, readyState: 4, error: null as unknown };
    for (const key of Object.keys(media) as (keyof typeof media)[]) {
      Object.defineProperty(audio, key, {
        configurable: true,
        get: () => media[key],
        set: (value) => {
          (media as Record<string, unknown>)[key] = value;
        },
      });
    }
    return media;
  }

  async function start() {
    render(<App />);
    await screen.findByText("Track a");
    const audio = document.querySelector("audio")!;
    const media = fakeMedia(audio);
    const fire = (type: string) => act(async () => void audio.dispatchEvent(new Event(type)));
    const playRow = async (index: number) => {
      await act(async () => {
        fireEvent.click(screen.getAllByRole("listitem")[index]);
      });
      // A new source starts at 0 until its metadata arrives and the saved position is applied.
      media.currentTime = 0;
      await fire("loadedmetadata");
      await fire("playing");
    };
    return { media, fire, playRow };
  }

  it("resumes a track from the position saved when leaving it, after going to another and back", async () => {
    const { media, fire, playRow } = await start();

    await playRow(0);
    media.currentTime = 40;
    await fire("timeupdate");

    // Leaving "a" saves where it was; nothing in the rendered list changes for it.
    await playRow(1);
    expect(onDisk("a").position).toBe(40);
    expect(media.currentTime).toBe(0);

    media.currentTime = 15;
    await playRow(0);
    expect(media.currentTime).toBe(40);
    expect(onDisk("b").position).toBe(15);
  });

  it("resumes from disk even when the list in React holds an older position", async () => {
    const { media, playRow } = await start();
    // Written behind the UI's back: the rendered list still says 0.
    write(disk.map((track) => (track.id === "a" ? { ...track, position: 123 } : track)));

    await playRow(0);

    expect(media.currentTime).toBe(123);
  });

  it("puts a removed track back with the position that was on disk", async () => {
    const { media, fire, playRow } = await start();
    await playRow(0);
    media.currentTime = 55;
    media.paused = true;
    await fire("pause");
    expect(onDisk("a").position).toBe(55);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove track" })[0]);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    });

    expect(backend.restoreTrack).toHaveBeenCalledOnce();
    expect(backend.restoreTrack.mock.calls[0][0].position).toBe(55);
  });
});

describe("reusing a stream resolved earlier", () => {
  const HOURS = 3600;
  /** A resolution whose stream stays valid for `lifeSeconds` from now. */
  const lasting = (id: string, lifeSeconds: number): ResolvedAudio => ({
    ...resolved(id),
    expiresAt: Date.now() / 1000 + lifeSeconds,
  });

  let life = 6 * HOURS;
  const resolutionsOf = (id: string) =>
    backend.resolveAudio.mock.calls.filter(([url]) => url === saved(id).url).length;

  beforeEach(() => {
    life = 6 * HOURS;
    backend.resolveAudio.mockImplementation((url: string) => Promise.resolve(lasting(url.slice(-1), life)));
    backend.upsertTrack.mockImplementation(() => Promise.resolve([saved("a"), saved("b")]));
  });

  function fakeMedia(audio: HTMLAudioElement) {
    const media = { duration: 100, currentTime: 0, paused: false, ended: false, readyState: 4, error: null as unknown };
    for (const key of Object.keys(media) as (keyof typeof media)[]) {
      Object.defineProperty(audio, key, {
        configurable: true,
        get: () => media[key],
        set: (value) => {
          (media as Record<string, unknown>)[key] = value;
        },
      });
    }
    return media;
  }

  async function start(library: Track[]) {
    const { input } = await renderApp(library);
    const audio = document.querySelector("audio")!;
    const media = fakeMedia(audio);
    const fire = (type: string) => act(async () => void audio.dispatchEvent(new Event(type)));
    const playRow = async (index: number) => {
      await act(async () => {
        fireEvent.click(screen.getAllByRole("listitem")[index]);
      });
      await fire("playing");
    };
    return { input, audio, media, fire, playRow };
  }

  it("plays a track that was just added without resolving it a second time", async () => {
    backend.upsertTrack.mockImplementation(() => Promise.resolve([saved("a")]));
    const { input, audio, playRow } = await start([]);

    await add(input, saved("a").url);
    expect(resolutionsOf("a")).toBe(1);

    await playRow(0);
    expect(audio.getAttribute("src")).toBe("https://stream.example/a.m3u8");
    expect(resolutionsOf("a")).toBe(1);
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("doesn't resolve again when coming back to a track or going back and forth", async () => {
    const { audio, playRow } = await start([saved("a"), saved("b")]);

    await playRow(0);
    await playRow(1);
    expect([resolutionsOf("a"), resolutionsOf("b")]).toEqual([1, 1]);

    for (const index of [0, 1, 0, 1, 0]) await playRow(index);
    expect([resolutionsOf("a"), resolutionsOf("b")]).toEqual([1, 1]);
    expect(audio.getAttribute("src")).toBe("https://stream.example/a.m3u8");
  });

  it("resolves again when the stream wouldn't outlive the rest of the track by 5 minutes", async () => {
    // A 100 s track needs more than 400 s of life left.
    life = 400;
    const { playRow } = await start([saved("a"), saved("b")]);

    await playRow(0);
    await playRow(1);
    await playRow(0);
    expect(resolutionsOf("a")).toBe(2);

    life = 401;
    await playRow(1);
    await playRow(0);
    // The stream resolved with 401 s of life is good for one more play.
    expect(resolutionsOf("a")).toBe(3);
    await playRow(1);
    await playRow(0);
    expect(resolutionsOf("a")).toBe(3);
  });

  it("sends a reused stream that fails to load through the usual recovery", async () => {
    const { audio, media, fire, playRow } = await start([saved("a"), saved("b")]);
    await playRow(0);
    await playRow(1);
    backend.resolveAudio.mockImplementation((url: string) =>
      url === saved("a").url ? Promise.reject({ code: "ytdlp_failed", detail: null }) : Promise.resolve(lasting("b", life)),
    );

    // Back to "a" on its remembered stream, which now fails before playing.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("listitem")[0]);
    });
    expect(audio.getAttribute("src")).toBe("https://stream.example/a.m3u8");
    media.error = { code: 4, message: "" };
    await fire("error");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't resume this track."));
    // The first play, then exactly the two attempts of the recovery.
    expect(resolutionsOf("a")).toBe(3);
  });

  it("forgets the stream of a removed track, even if the removal is undone", async () => {
    backend.deleteTrack.mockResolvedValue([saved("b")]);
    backend.restoreTrack.mockResolvedValue([saved("a"), saved("b")]);
    const { playRow } = await start([saved("a"), saved("b")]);
    await playRow(0);
    await playRow(1);
    expect(resolutionsOf("a")).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove track" })[0]);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    });
    await playRow(0);

    expect(resolutionsOf("a")).toBe(2);
  });
});

describe("pressing next several times in a row", () => {
  const HOURS = 3600;
  const lasting = (id: string): ResolvedAudio => ({ ...resolved(id), expiresAt: Date.now() / 1000 + 6 * HOURS });
  const library = () => ["a", "b", "c", "d"].map(saved);
  const resolutionsOf = (id: string) =>
    backend.resolveAudio.mock.calls.filter(([url]) => url === saved(id).url).length;
  const header = () => document.querySelector('[data-slot="track-title"]')?.textContent || null;
  const currentRow = () => document.querySelector('li[aria-current="true"]')?.textContent ?? null;

  afterEach(() => vi.useRealTimers());

  /** The library [a, b, c, d] with "a" playing, and the clock under the test's control from then on. */
  async function playingFirst() {
    backend.upsertTrack.mockImplementation(() => Promise.resolve(library()));
    backend.resolveAudio.mockImplementation((url: string) => Promise.resolve(lasting(url.slice(-1))));
    await renderApp(library());
    const audio = document.querySelector("audio")!;
    for (const [key, value] of Object.entries({ paused: false, ended: false, readyState: 4, duration: 100, currentTime: 0 })) {
      Object.defineProperty(audio, key, { configurable: true, get: () => value });
    }
    const playRow = async (index: number) => {
      await act(async () => {
        fireEvent.click(screen.getAllByRole("listitem")[index]);
      });
      await act(async () => void audio.dispatchEvent(new Event("playing")));
    };
    await playRow(0);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pressNext = () =>
      act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Next track" }));
      });
    const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    return { audio, playRow, pressNext, wait };
  }

  it("shows each track at once but resolves only the one the presses end on", async () => {
    const { audio, pressNext, wait } = await playingFirst();

    await pressNext();
    expect(header()).toBe("Track b");
    expect(currentRow()).toContain("Track b");
    await wait(100);
    await pressNext();
    expect(header()).toBe("Track c");
    await wait(100);
    await pressNext();
    expect(header()).toBe("Track d");
    expect(currentRow()).toContain("Track d");

    await wait(299);
    expect([resolutionsOf("b"), resolutionsOf("c"), resolutionsOf("d")]).toEqual([0, 0, 0]);
    expect(audio.getAttribute("src")).toBeNull();

    await wait(1);
    expect([resolutionsOf("b"), resolutionsOf("c"), resolutionsOf("d")]).toEqual([0, 0, 1]);
    expect(audio.getAttribute("src")).toBe("https://stream.example/d.m3u8");
  });

  it("keeps next available while the track it landed on is still loading", async () => {
    const { pressNext } = await playingFirst();

    await pressNext();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next track" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Previous track" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("doesn't wait at all when the stream of the next track is already known", async () => {
    vi.useRealTimers();
    backend.upsertTrack.mockImplementation(() => Promise.resolve(library()));
    backend.resolveAudio.mockImplementation((url: string) => Promise.resolve(lasting(url.slice(-1))));
    await renderApp(library());
    const audio = document.querySelector("audio")!;
    for (const [key, value] of Object.entries({ paused: false, ended: false, readyState: 4, duration: 100, currentTime: 0 })) {
      Object.defineProperty(audio, key, { configurable: true, get: () => value });
    }
    const playRow = async (index: number) => {
      await act(async () => {
        fireEvent.click(screen.getAllByRole("listitem")[index]);
      });
      await act(async () => void audio.dispatchEvent(new Event("playing")));
    };
    // "b" has been played before: its stream is remembered.
    await playRow(1);
    await playRow(0);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next track" }));
    });

    // No timer has advanced.
    expect(audio.getAttribute("src")).toBe("https://stream.example/b.m3u8");
    expect(resolutionsOf("b")).toBe(1);
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});

describe("volume", () => {
  const label = (element: HTMLElement) =>
    element.tagName === "LI" ? "library row" : (element.getAttribute("aria-label") ?? element.textContent);

  async function playing() {
    backend.resolveAudio.mockImplementation((url: string) => Promise.resolve(resolved(url.slice(-1))));
    backend.upsertTrack.mockResolvedValue([saved("a"), saved("b")]);
    await renderApp([saved("a"), saved("b")]);
    const audio = document.querySelector("audio")!;
    const media = { paused: false, ended: false, readyState: 4, duration: 100, currentTime: 0 };
    for (const key of Object.keys(media) as (keyof typeof media)[]) {
      Object.defineProperty(audio, key, { configurable: true, get: () => media[key] });
    }
    await act(async () => {
      fireEvent.click(screen.getAllByRole("listitem")[0]);
    });
    await act(async () => void audio.dispatchEvent(new Event("playing")));
    await act(async () => void audio.dispatchEvent(new Event("durationchange")));
    return { audio, media };
  }

  it("comes last in the tab order: repeat, then mute, then the slider", async () => {
    await playing();

    expect(tabStops(document.body).map(label)).toEqual([
      "YouTube URL",
      "library row",
      "Progress",
      "Previous track",
      "Pause",
      "Next track",
      "Repeat: all",
      "Mute (volume 100%)",
      "Volume: 100%",
    ]);
  });

  it("sets the level of the audio element, and silences it without losing the level", async () => {
    const { audio } = await playing();
    const slider = screen.getByRole("slider", { name: /^Volume/ });

    fireEvent.change(slider, { target: { value: "40" } });
    expect(audio.volume).toBeCloseTo(0.4);

    fireEvent.click(screen.getByRole("button", { name: "Mute (volume 40%)" }));
    expect(audio.volume).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Unmute (volume 40%)" }));
    expect(audio.volume).toBeCloseTo(0.4);
  });

  it("doesn't change with playback: only the user moves it", async () => {
    const { audio, media } = await playing();
    fireEvent.change(screen.getByRole("slider", { name: /^Volume/ }), { target: { value: "40" } });

    for (const time of [10, 20, 30]) {
      media.currentTime = time;
      await act(async () => void audio.dispatchEvent(new Event("timeupdate")));
    }
    // A stray volume change on the element (nothing in the app does this) isn't picked up either.
    await act(async () => void audio.dispatchEvent(new Event("volumechange")));

    expect(screen.getByRole("slider", { name: "Volume: 40%" })).toBeTruthy();
    expect(audio.volume).toBeCloseTo(0.4);
  });
});


describe("menu behind a right click on the icon", () => {
  beforeEach(() => {
    backend.setTrayMenu.mockClear();
    backend.showPopover.mockClear();
  });

  it("offers Play for a library with nothing loaded, and starts the track played last", async () => {
    const played = { ...saved("b"), lastPlayedAt: "2026-10-09T10:00:00Z" };
    backend.resolveAudio.mockResolvedValue(resolved("b"));
    backend.upsertTrack.mockResolvedValue([saved("a"), played]);
    await renderApp([saved("a"), played]);
    await waitFor(() =>
      expect(backend.setTrayMenu).toHaveBeenLastCalledWith({ title: null, playing: false, canToggle: true, canNext: false }),
    );

    await act(async () => backend.trayAction("toggle"));
    expect(backend.resolveAudio).toHaveBeenCalledWith("https://www.youtube.com/watch?v=b");

    await act(async () => void document.querySelector("audio")!.dispatchEvent(new Event("playing")));
    expect(backend.setTrayMenu).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Track b", playing: true, canToggle: true }));
    expect(backend.showPopover).not.toHaveBeenCalled();
  });

  it("has nothing to play in an empty library", async () => {
    await renderApp();
    await waitFor(() => expect(backend.setTrayMenu).toHaveBeenLastCalledWith(expect.objectContaining({ canToggle: false })));
  });

  it("opens the popover when what it started fails", async () => {
    backend.resolveAudio.mockRejectedValue({ code: "rate_limited", detail: null });
    await renderApp([saved("a")]);

    await act(async () => backend.trayAction("toggle"));

    await waitFor(() => expect(backend.showPopover).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert").textContent).toContain("YouTube is limiting requests right now.");
  });
});
