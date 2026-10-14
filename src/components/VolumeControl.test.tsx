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
  return {
    ...handlers,
    slider: screen.getByRole("slider", { hidden: true }) as HTMLInputElement,
    button: screen.getByRole("button", { name: /^Volume/ }),
    mute: screen.getByRole("button", { name: "Mute", hidden: true }),
    panel: () => container.querySelector(".volume-flyout") as HTMLElement,
    level: () => (container.firstChild as HTMLElement).dataset.level,
  };
}

afterEach(cleanup);

describe("VolumeControl", () => {
  it("names the level in percent on the slider and on the button", () => {
    const { slider, button, mute } = setup(80);

    expect(slider.getAttribute("aria-label")).toBe("Volume: 80%");
    expect(slider.getAttribute("aria-valuetext")).toBe("80%");
    expect(button.getAttribute("aria-label")).toBe("Volume: 80%");
    expect(mute.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a muted slider at 0 while the button remembers the level", () => {
    const { slider, button, mute } = setup(80, true);

    expect(slider.value).toBe("0");
    expect(slider.getAttribute("aria-label")).toBe("Volume: 0%");
    expect(button.getAttribute("aria-label")).toBe("Volume: muted (80%)");
    expect(mute.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens on click, and keeps the closed panel out of the tab order", () => {
    const { button, panel } = setup(80);

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(tabStops(document.body).map((element) => element.getAttribute("aria-label") ?? element.textContent)).toEqual([
      "Volume: 80%",
      "Elsewhere",
    ]);

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(tabStops(document.body).map((element) => element.getAttribute("aria-label") ?? element.textContent)).toEqual([
      "Volume: 80%",
      "Volume: 80%",
      "Mute",
      "Elsewhere",
    ]);

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and gives the focus back to the button", () => {
    const { button, slider } = setup(80);

    fireEvent.click(button);
    slider.focus();
    fireEvent.keyDown(slider, { key: "Escape" });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("closes on a click outside, but not on one inside", () => {
    const { button, slider } = setup(80);

    fireEvent.click(button);
    fireEvent.pointerDown(slider);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerDown(document.body);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when the focus leaves it", () => {
    const { button, mute } = setup(80);

    fireEvent.click(button);
    act(() => mute.focus());
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());

    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("uses a different icon for muted, low and high", () => {
    expect(setup(80, true).level()).toBe("muted");
    cleanup();
    expect(setup(0).level()).toBe("muted");
    cleanup();
    expect(setup(30).level()).toBe("low");
    cleanup();
    expect(setup(80).level()).toBe("high");
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

    const full = setup(100);
    fireEvent.keyDown(full.slider, { key: "ArrowRight" });
    expect(full.onVolumeChange).toHaveBeenLastCalledWith(100);
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

  it("reports dragging and the mute toggle", () => {
    const { slider, mute, onVolumeChange, onToggleMute } = setup(50);

    fireEvent.change(slider, { target: { value: "72" } });
    fireEvent.click(mute);

    expect(onVolumeChange).toHaveBeenLastCalledWith(72);
    expect(onToggleMute).toHaveBeenCalledOnce();
  });
});
