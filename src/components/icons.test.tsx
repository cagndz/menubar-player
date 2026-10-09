// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PauseIcon, PlayIcon, PlayPauseIcon } from "./icons";

const shapes = (container: HTMLElement) => Array.from(container.querySelectorAll("path")).map((path) => path.getAttribute("d"));
const points = (d: string | null) => (d ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];

afterEach(cleanup);

describe("PlayPauseIcon", () => {
  it("draws play and pause with the same number of points, so one can become the other", () => {
    const play = shapes(render(<PlayIcon />).container);
    cleanup();
    const pause = shapes(render(<PauseIcon />).container);

    expect(play).toHaveLength(2);
    expect(pause).toHaveLength(2);
    for (let half = 0; half < 2; half++) {
      expect(points(play[half])).toHaveLength(8);
      expect(points(pause[half])).toHaveLength(8);
    }
  });

  it("starts as the state it is given, without animating on first paint", () => {
    const paused = render(<PlayPauseIcon playing={false} />);
    expect(shapes(paused.container)).toEqual(shapes(render(<PlayIcon />).container));
    cleanup();

    const playing = render(<PlayPauseIcon playing />);
    expect(shapes(playing.container)).toEqual(shapes(render(<PauseIcon />).container));
  });

  it("ends up as pause after playback starts, and back as play after it stops", async () => {
    const pause = shapes(render(<PauseIcon />).container).map(points);
    cleanup();
    const play = shapes(render(<PlayIcon />).container).map(points);
    cleanup();

    const view = render(<PlayPauseIcon playing={false} />);
    view.rerender(<PlayPauseIcon playing />);
    await waitFor(() => expect(shapes(view.container).map(points)).toEqual(pause));

    view.rerender(<PlayPauseIcon playing={false} />);
    await waitFor(() => expect(shapes(view.container).map(points)).toEqual(play));
  });
});
