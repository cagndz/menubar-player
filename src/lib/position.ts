import { useSyncExternalStore } from "react";

// The playback position lives apart from the player's state. It is the one
// value that changes every second while something plays; kept in that state,
// each tick re-rendered the whole popover. Here only what shows it subscribes.

export interface PositionSource {
  get: () => number;
  subscribe: (listener: () => void) => () => void;
}

export interface PositionStore extends PositionSource {
  set: (seconds: number) => void;
}

export function createPositionStore(initial = 0): PositionStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (seconds) => {
      if (seconds === value) return;
      value = seconds;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The position, re-rendering the calling component (and only it) when it changes. */
export function usePosition(source: PositionSource): number {
  return useSyncExternalStore(source.subscribe, source.get);
}
