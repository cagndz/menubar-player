// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VolumeControl } from "./VolumeControl";

function setup(volume: number, muted = false) {
  const handlers = { onVolumeChange: vi.fn(), onToggleMute: vi.fn() };
  const { container } = render(<VolumeControl volume={volume} muted={muted} {...handlers} />);
  return {
    ...handlers,
    slider: screen.getByRole("slider") as HTMLInputElement,
    button: screen.getByRole("button"),
    level: () => (container.firstChild as HTMLElement).dataset.level,
  };
}

afterEach(cleanup);

describe("VolumeControl", () => {
  it("names the level in percent on the slider and on the mute button", () => {
    const { slider, button } = setup(80);

    expect(slider.getAttribute("aria-label")).toBe("Volume: 80%");
    expect(slider.getAttribute("aria-valuetext")).toBe("80%");
    expect(button.getAttribute("aria-label")).toBe("Mute (volume 80%)");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a muted slider at 0 while the button remembers the level", () => {
    const { slider, button } = setup(80, true);

    expect(slider.value).toBe("0");
    expect(slider.getAttribute("aria-label")).toBe("Volume: 0%");
    expect(button.getAttribute("aria-label")).toBe("Unmute (volume 80%)");
    expect(button.getAttribute("aria-pressed")).toBe("true");
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

  it("reports dragging and the mute button", () => {
    const { slider, button, onVolumeChange, onToggleMute } = setup(50);

    fireEvent.change(slider, { target: { value: "72" } });
    fireEvent.click(button);

    expect(onVolumeChange).toHaveBeenLastCalledWith(72);
    expect(onToggleMute).toHaveBeenCalledOnce();
  });
});
