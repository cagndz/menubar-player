import { useCallback, useState } from "react";
import { nextRepeatMode, parseRepeatMode, type RepeatMode } from "../lib/mediaNavigation";

const STORAGE_KEY = "menubar-player:repeat";

// Storage can be unavailable or full; the mode then simply lasts for this run.
function readStored(): RepeatMode {
  try {
    return parseRepeatMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseRepeatMode(null);
  }
}

function store(mode: RepeatMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Nothing to do: the choice still applies until the app closes.
  }
}

/** The repeat mode, remembered across launches. `cycle` moves off -> all -> one. */
export function useRepeatMode() {
  const [mode, setMode] = useState<RepeatMode>(readStored);

  const cycle = useCallback(() => {
    setMode((current) => {
      const next = nextRepeatMode(current);
      store(next);
      return next;
    });
  }, []);

  return { mode, cycle };
}
