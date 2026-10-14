// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackWindowShown } from "./windowShown";

afterEach(() => vi.restoreAllMocks());

describe("trackWindowShown", () => {
  it("marks the document hidden when the popover loses focus, and shown when it gets it back", () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const stop = trackWindowShown();
    const state = () => document.documentElement.dataset.window;
    expect(state()).toBe("shown");

    focus.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    expect(state()).toBe("hidden");

    focus.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(state()).toBe("shown");

    stop();
    focus.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    expect(state()).toBe("shown");
  });
});
