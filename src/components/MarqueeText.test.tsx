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
  it("reads the whole title aloud, with no tooltip to cover the controls", async () => {
    layout({ text: 600, box: 200 });
    setup();

    expect(screen.getByText(LONG)).toBeTruthy();
    expect(document.querySelector("[title]")).toBeNull();
  });

  it("shows the whole title as a tooltip with Reduce Motion, when it can't scroll", async () => {
    reduceMotion(true);
    layout({ text: 600, box: 200 });
    setup();

    expect(screen.getByTitle(LONG).textContent).toBe(LONG);
  });

  it("waits half a second on hover, then loops round at a constant speed without stopping", async () => {
    layout({ text: 600, box: 200 });
    const host = setup();

    fireEvent.pointerEnter(host);
    await act(() => vi.advanceTimersByTimeAsync(450));
    expect(animate).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(animate).toHaveBeenCalledOnce();
    const [keyframes, options] = animate.mock.calls[0];
    // One pass is the title (600 px) plus the 32 px gap, at 40 px a second.
    expect(keyframes).toEqual([{ transform: "translateX(0)" }, { transform: "translateX(-632px)" }]);
    expect(options).toEqual({ duration: 15_800, easing: "linear", iterations: Infinity });
  });

  it("brings in a copy of the title only while it scrolls, hidden from assistive technology", async () => {
    layout({ text: 600, box: 200 });
    const host = setup();
    expect(screen.getAllByText(LONG)).toHaveLength(1);

    fireEvent.pointerEnter(host);
    await act(() => vi.advanceTimersByTimeAsync(600));
    const [title, copy] = screen.getAllByText(LONG);
    expect(title.getAttribute("aria-hidden")).toBeNull();
    expect(copy.getAttribute("aria-hidden")).toBe("true");
  });

  it("glides to the nearest start when released, then goes back to a single title", async () => {
    layout({ text: 600, box: 200 });
    const host = setup();
    const finished: (() => void)[] = [];
    animate.mockImplementation(() => ({
      finished: new Promise<void>((resolve) => finished.push(resolve)),
      cancel: vi.fn(),
    }));

    fireEvent.pointerEnter(host);
    await act(() => vi.advanceTimersByTimeAsync(600));
    fireEvent.pointerLeave(host);

    const [keyframes, options] = animate.mock.calls[1];
    expect(keyframes).toEqual([{ transform: "translateX(0px)" }, { transform: "translateX(0px)" }]);
    expect(options).toMatchObject({ duration: 200 });
    await act(async () => finished[1]());
    expect(screen.getAllByText(LONG)).toHaveLength(1);
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
