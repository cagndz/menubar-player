// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../lib/tauri";
import { TrackList, type TrackListHandle } from "./TrackList";

const track = (id: string): Track => ({
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Track ${id}`,
  duration: 100,
  position: 10,
  addedAt: "2026-10-08T10:00:00Z",
  lastPlayedAt: "2026-10-08T10:00:00Z",
});

function setup(ids: string[], current: { id: string | null; playing: boolean } = { id: null, playing: false }) {
  const handlers = { onPlay: vi.fn(), onDelete: vi.fn(), onExitUp: vi.fn() };
  render(<TrackList tracks={ids.map(track)} currentId={current.id} playing={current.playing} {...handlers} />);
  return { ...handlers, rows: screen.getAllByRole("listitem") };
}

const tabIndexes = (rows: HTMLElement[]) => rows.map((row) => row.tabIndex);

afterEach(cleanup);

describe("TrackList keyboard access", () => {
  it("is a single tab stop: one row has tabindex 0, the rest and every delete button have -1", () => {
    const { rows } = setup(["a", "b", "c"]);

    expect(tabIndexes(rows)).toEqual([0, -1, -1]);
    for (const button of screen.getAllByRole("button")) {
      expect(button.tabIndex).toBe(-1);
    }
  });

  it("moves the tab stop with the arrow keys and stays on the last row", () => {
    const { rows } = setup(["a", "b", "c"]);
    rows[0].focus();

    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    expect(tabIndexes(rows)).toEqual([-1, 0, -1]);

    fireEvent.keyDown(rows[1], { key: "ArrowDown" });
    fireEvent.keyDown(rows[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[2]);
    expect(tabIndexes(rows)).toEqual([-1, -1, 0]);

    fireEvent.keyDown(rows[2], { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[1]);
  });

  it("hands focus back upwards from the first row", () => {
    const { rows, onExitUp } = setup(["a"]);
    rows[0].focus();

    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[0]);
    expect(onExitUp).not.toHaveBeenCalled();

    fireEvent.keyDown(rows[0], { key: "ArrowUp" });
    expect(onExitUp).toHaveBeenCalledOnce();
  });

  it("plays with Enter and deletes with Delete or Backspace on the row", () => {
    const { rows, onPlay, onDelete } = setup(["a", "b"]);

    fireEvent.keyDown(rows[1], { key: "Enter" });
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(track("b"));

    fireEvent.keyDown(rows[0], { key: "Delete" });
    fireEvent.keyDown(rows[1], { key: "Backspace" });
    expect(onDelete.mock.calls).toEqual([[track("a")], [track("b")]]);
  });
});

describe("TrackList row state", () => {
  const states = (rows: HTMLElement[]) => rows.map((row) => row.dataset.state);

  it("offers to pause the current track while it plays", () => {
    const { rows } = setup(["a", "b"], { id: "a", playing: true });

    expect(states(rows)).toEqual(["playing", "idle"]);
    expect(screen.getByRole("button", { name: "Pause Track a" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play Track b" })).toBeTruthy();
  });

  it("offers to play the current track while it is paused", () => {
    const { rows } = setup(["a", "b"], { id: "b", playing: false });

    expect(states(rows)).toEqual(["idle", "paused"]);
    expect(screen.getByRole("button", { name: "Play Track b" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pause/ })).toBeNull();
  });

  it("keeps every row idle when nothing is loaded", () => {
    const { rows } = setup(["a", "b"]);

    expect(states(rows)).toEqual(["idle", "idle"]);
    expect(screen.getAllByRole("button", { name: /^Play Track/ })).toHaveLength(2);
  });

  it("does the same on the state icon as on the row", () => {
    const { onPlay } = setup(["a", "b"], { id: "a", playing: true });

    fireEvent.click(screen.getByRole("button", { name: "Pause Track a" }));
    fireEvent.click(screen.getByRole("button", { name: "Play Track b" }));
    expect(onPlay.mock.calls).toEqual([[track("a")], [track("b")]]);
  });

  it("removes from the X without playing the row", () => {
    const { onPlay, onDelete } = setup(["a", "b"]);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove track" })[1]);
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(track("b"));
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe("TrackList revealing a track", () => {
  it("scrolls to a row that is asked for before it is listed", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const ref = createRef<TrackListHandle>();
    const list = (ids: string[]) => (
      <TrackList ref={ref} tracks={ids.map(track)} currentId={null} playing={false} onPlay={vi.fn()} onDelete={vi.fn()} onExitUp={vi.fn()} />
    );
    const { rerender } = render(list(["a", "b"]));

    act(() => ref.current!.revealRow("c"));
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(list(["a", "b", "c"]));
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getAllByRole("listitem")[2]);

    // Only once: a later change of the list doesn't scroll again.
    rerender(list(["a", "c"]));
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});
