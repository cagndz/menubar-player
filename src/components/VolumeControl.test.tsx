// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tabStops } from "../lib/focus";
import { VolumeControl } from "./VolumeControl";

function setup(volume: number, muted = false) {
  const handlers = { onVolumeChange: vi.fn(), onToggleMute: vi.fn() };
  const { container } = render(
    <>
      <VolumeControl volume={volume} muted={muted} {...handlers} />
      <button type="button">Elsewhere</button>
    </>,
  );
  const root = container.firstChild as HTMLElement;
  return {
    ...handlers,
    slider: screen.getByRole("slider", { hidden: true }) as HTMLInputElement,
    button: screen.getByRole("button", { name: "Mute" }),
    shown: () => root.dataset.open === "true",
    level: () => root.dataset.level,
  };
}

const names = () => tabStops(document.body).map((element) => element.getAttribute("aria-label") ?? element.textContent);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("VolumeControl", () => {
  it("mutes from the button, which says whether it is pressed", () => {
    const { button, onToggleMute } = setup(80);

    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggleMute).toHaveBeenCalledOnce();
  });

  it("shows a muted slider at 0 while the level is kept", () => {
    const { slider, button } = setup(80, true);

    expect(slider.value).toBe("0");
    expect(slider.getAttribute("aria-label")).toBe("Volume: 0%");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("names the level in percent on the slider", () => {
    const { slider } = setup(80);

    expect(slider.getAttribute("aria-label")).toBe("Volume: 80%");
    expect(slider.getAttribute("aria-valuetext")).toBe("80%");
  });

  it("uses the crossed speaker for muted and for 0, and waves for low and high", () => {
    expect(setup(80, true).level()).toBe("muted");
    cleanup();
    expect(setup(0).level()).toBe("muted");
    cleanup();
    expect(setup(30).level()).toBe("low");
    cleanup();
    expect(setup(80).level()).toBe("high");
  });

  it("shows the slider with the pointer on the button or the slider, and hides it a moment after it leaves", () => {
    vi.useFakeTimers();
    const { button, slider, shown } = setup(80);
    const area = slider.closest(".volume-slider")!;

    expect(shown()).toBe(false);
    fireEvent.pointerEnter(button);
    expect(shown()).toBe(true);

    // Crossing from the button to the slider keeps it.
    fireEvent.pointerLeave(button);
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.pointerEnter(area);
    act(() => void vi.advanceTimersByTime(500));
    expect(shown()).toBe(true);

    fireEvent.pointerLeave(area);
    act(() => void vi.advanceTimersByTime(100));
    expect(shown()).toBe(true);
    act(() => void vi.advanceTimersByTime(50));
    expect(shown()).toBe(false);
  });

  it("keeps the hidden slider out of the tab order, and brings it in when the button has the focus", () => {
    const { button, shown } = setup(80);

    expect(names()).toEqual(["Mute", "Elsewhere"]);
    act(() => button.focus());
    expect(shown()).toBe(true);
    expect(names()).toEqual(["Mute", "Volume: 80%", "Elsewhere"]);
  });

  it("hides when the focus leaves, and on Escape gives the focus back to the button", () => {
    const { button, slider, shown } = setup(80);

    act(() => button.focus());
    act(() => slider.focus());
    fireEvent.keyDown(slider, { key: "Escape" });
    expect(shown()).toBe(false);
    expect(document.activeElement).toBe(button);

    act(() => slider.focus());
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    expect(shown()).toBe(false);
    act(() => button.focus());
    expect(shown()).toBe(true);
  });

  it("moves 5 at a time with the arrow keys", () => {
    const { slider, onVolumeChange } = setup(50);

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowDown" });

    expect(onVolumeChange.mock.calls).toEqual([[55], [55], [45], [45]]);
  });

  it("stops at 0 and at 100", () => {
    const top = setup(98);
    fireEvent.keyDown(top.slider, { key: "ArrowRight" });
    expect(top.onVolumeChange).toHaveBeenLastCalledWith(100);
    cleanup();

    const bottom = setup(3);
    fireEvent.keyDown(bottom.slider, { key: "ArrowLeft" });
    expect(bottom.onVolumeChange).toHaveBeenLastCalledWith(0);
  });

  it("raises from silence when an arrow is pressed while muted", () => {
    const { slider, onVolumeChange } = setup(80, true);

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onVolumeChange).toHaveBeenLastCalledWith(5);
  });

  it("reports dragging", () => {
    const { slider, onVolumeChange } = setup(50);

    fireEvent.change(slider, { target: { value: "72" } });
    expect(onVolumeChange).toHaveBeenLastCalledWith(72);
  });
});
