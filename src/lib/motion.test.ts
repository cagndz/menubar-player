// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "./motion";

afterEach(() => vi.unstubAllGlobals());

describe("useReducedMotion", () => {
  it("follows the system setting as it changes", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return matches && query === "(prefers-reduced-motion: reduce)";
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    matches = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current).toBe(true);
  });

  it("assumes full motion where the query isn't available", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });
});
