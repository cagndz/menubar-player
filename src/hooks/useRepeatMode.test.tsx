// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRepeatMode } from "./useRepeatMode";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useRepeatMode", () => {
  it("defaults to repeat all", () => {
    expect(renderHook(() => useRepeatMode()).result.current.mode).toBe("all");
  });

  it("cycles all -> one -> off and remembers the choice", () => {
    const first = renderHook(() => useRepeatMode());
    act(() => first.result.current.cycle());
    expect(first.result.current.mode).toBe("one");
    act(() => first.result.current.cycle());
    expect(first.result.current.mode).toBe("off");

    // A fresh mount stands for the next launch.
    expect(renderHook(() => useRepeatMode()).result.current.mode).toBe("off");
  });

  it("keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    const { result } = renderHook(() => useRepeatMode());
    expect(result.current.mode).toBe("all");
    act(() => result.current.cycle());
    expect(result.current.mode).toBe("one");
  });
});
