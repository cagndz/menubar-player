// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarqueeText } from "./MarqueeText";

const LONG = "Aphex Twin Live at Field Day 2017 (full set, soundboard recording, remastered audio)";

let animate: ReturnType<typeof vi.fn>;

/** jsdom lays nothing out: these are the widths the browser would measure. */
function layout({ text, box }: { text: number; box: number }) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(text);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(box);
}

function reduceMotion(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: on && query.includes("reduce"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function setup(text = LONG) {
  render(
    <div data-marquee-host data-testid="host" tabIndex={0}>
      <MarqueeText text={text} />
    </div>,
  );
  return screen.getByTestId("host");
}

beforeEach(() => {
  vi.useFakeTimers();
  reduceMotion(false);
  animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", { configurable: true, value: () => [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MarqueeText", () => {
  it("keeps the whole title as the tooltip and in the text read aloud", async () => {
    layout({ text: 600, box: 200 });
    setup();

    expect(screen.getByTitle(LONG).textContent).toBe(LONG);
  });

  it("waits half a second on hover before it moves, so passing over a row moves nothing", async () => {
    layout({ text: 600, box: 200 });
    const host = setup();

    fireEvent.pointerEnter(host);
    await act(() => vi.advanceTimersByTimeAsync(450));
    expect(animate).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(animate).toHaveBeenCalledOnce();
    const [keyframes, options] = animate.mock.calls[0];
    // 400 px left over at 40 px a second, at constant speed.
    expect(keyframes).toEqual([{ transform: "translateX(0)" }, { transform: "translateX(-400px)" }]);
    expect(options).toMatchObject({ duration: 10_000, easing: "linear" });
  });

  it("moves with the keyboard focus as it does with the pointer", async () => {
    layout({ text: 600, box: 200 });
    const host = setup();

    act(() => host.focus());
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(animate).toHaveBeenCalledOnce();
  });

  it("stays still when the title fits", async () => {
    layout({ text: 150, box: 200 });
    const host = setup("Short interlude");

    fireEvent.pointerEnter(host);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(animate).not.toHaveBeenCalled();
  });

  it("never moves with Reduce Motion", async () => {
    reduceMotion(true);
    layout({ text: 600, box: 200 });
    const host = setup();

    fireEvent.pointerEnter(host);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(animate).not.toHaveBeenCalled();
  });

  it("starts nothing if the pointer leaves before the half second", async () => {
    layout({ text: 600, box: 200 });
    const host = setup();

    fireEvent.pointerEnter(host);
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.pointerLeave(host);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(animate).not.toHaveBeenCalled();
  });
});
