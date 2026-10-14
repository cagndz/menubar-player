// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PopoverView } from "./PopoverView";

// jsdom lays nothing out, so the library's scrollbar has nothing to observe.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Makes the system report Reduce Motion on or off. */
function reduceMotion(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: on && query.includes("reduce"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const base = {
  urlInput: null,
  addNotice: null,
  list: null,
  libraryError: null,
  title: null,
  statusLabel: null,
  error: null,
  onRetry: null,
  controls: null,
};

/** Renders the popover, then offers an undo, and returns the notice as it first appears. */
function showUndo() {
  const view = render(<PopoverView {...base} onUndo={null} />);
  view.rerender(<PopoverView {...base} onUndo={() => {}} />);
  return screen.getByText(/Track removed/).closest("p") as HTMLElement;
}

describe("the undo notice", () => {
  it("rises a little as it fades in", async () => {
    reduceMotion(false);
    const notice = showUndo();

    expect(notice.style.opacity).toBe("0");
    expect(notice.style.transform).toContain("translateY(4px)");
    await waitFor(() => expect(notice.style.opacity).toBe("1"));
  });

  it("only fades with Reduce Motion, without moving", async () => {
    reduceMotion(true);
    const notice = showUndo();

    expect(notice.style.opacity).toBe("0");
    expect(notice.style.transform).not.toContain("translate");
    await waitFor(() => expect(notice.style.opacity).toBe("1"));
    expect(notice.style.transform).not.toContain("translate");
  });
});
