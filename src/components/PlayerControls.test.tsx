// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tabStops } from "../lib/focus";
import { PlayerControls } from "./PlayerControls";

function setup(overrides: Partial<Parameters<typeof PlayerControls>[0]> = {}) {
  const handlers = { onToggle: vi.fn(), onSeek: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onCycleRepeat: vi.fn() };
  render(
    <PlayerControls
      status="playing"
      currentTime={30}
      duration={600}
      canPrevious
      canNext
      repeat="all"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

const label = (element: HTMLElement) => element.getAttribute("aria-label") ?? element.textContent;

afterEach(cleanup);

describe("PlayerControls", () => {
  it("is tabbed through as bar, previous, play/pause, next, repeat", () => {
    setup();

    expect(tabStops(document.body).map(label)).toEqual([
      "Progress",
      "Previous track",
      "Pause",
      "Next track",
      "Repeat: all",
    ]);
  });

  it("calls the shared previous and next handlers", () => {
    const { onPrevious, onNext } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Previous track" }));
    fireEvent.click(screen.getByRole("button", { name: "Next track" }));

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("disables next when there is nowhere to go", () => {
    setup({ canNext: false });

    expect((screen.getByRole("button", { name: "Next track" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Previous track" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("names the repeat mode and cycles it on click", () => {
    const { onCycleRepeat } = setup({ repeat: "one" });

    fireEvent.click(screen.getByRole("button", { name: "Repeat: one" }));
    expect(onCycleRepeat).toHaveBeenCalledOnce();
  });

  it("keeps repeat available with nothing loaded, and the rest disabled", () => {
    setup({ status: "idle", repeat: "off", canPrevious: false, canNext: false });

    expect(tabStops(document.body).map(label)).toEqual(["Repeat: off"]);
  });
});

describe("PlayerControls progress bar motion", () => {
  const bar = () => screen.getByRole("slider", { name: "Progress" }).parentElement as HTMLElement;

  function playingAt(time: number, overrides: Partial<Parameters<typeof PlayerControls>[0]> = {}) {
    const props = {
      status: "playing" as const,
      currentTime: time,
      duration: 600,
      canPrevious: true,
      canNext: true,
      repeat: "all" as const,
      onToggle: vi.fn(),
      onSeek: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onCycleRepeat: vi.fn(),
      ...overrides,
    };
    const view = render(<PlayerControls {...props} />);
    return { at: (next: number, more = {}) => view.rerender(<PlayerControls {...props} currentTime={next} {...more} />) };
  }

  it("glides while playback moves on a second at a time", () => {
    const { at } = playingAt(30);
    expect(bar().dataset.smooth).toBe("true");

    at(31);
    expect(bar().dataset.smooth).toBe("true");
  });

  it("jumps, without gliding, on a seek or after the popover was closed for a while", () => {
    const { at } = playingAt(30);

    at(95);
    expect(bar().dataset.smooth).toBe("false");
    // From there on it is ordinary playback again.
    at(96);
    expect(bar().dataset.smooth).toBe("true");
  });

  it("doesn't glide in pause or while reconnecting", () => {
    const { at } = playingAt(30);

    at(30, { status: "paused" });
    expect(bar().dataset.smooth).toBe("false");

    at(31, { status: "playing", recovering: true });
    expect(bar().dataset.smooth).toBe("false");
  });

  it("shows the time under the pointer and hides it when the pointer leaves", () => {
    playingAt(30);
    const tip = bar().querySelector("output") as HTMLElement;
    expect(tip.dataset.shown).toBe("false");

    fireEvent.pointerMove(bar(), { clientX: 10 });
    expect(tip.dataset.shown).toBe("true");

    fireEvent.pointerLeave(bar());
    expect(tip.dataset.shown).toBe("false");
  });
});

