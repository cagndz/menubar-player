import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { effectiveVolume, parseVolumeState, toggleMuted, withVolume, type VolumeState } from "../lib/volume";

const STORAGE_KEY = "menubar-player:volume";
/** Saved this long after the last change, so dragging the slider writes once, not on every step. */
const SAVE_DELAY_MS = 250;

// Storage can be unavailable or full; the level then simply lasts for this run.
function readStored(): VolumeState {
  try {
    return parseVolumeState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseVolumeState(null);
  }
}

function store(state: VolumeState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Nothing to do: the level still applies until the app closes.
  }
}

/**
 * The volume, remembered across launches and applied to the audio element.
 * It changes only when the user changes it: nothing here follows playback.
 */
export function useVolume(audioRef: RefObject<HTMLAudioElement | null>) {
  const [state, setState] = useState<VolumeState>(readStored);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = effectiveVolume(state);
  }, [audioRef, state]);

  useEffect(() => {
    // The first render only reflects what is already stored.
    if (!dirtyRef.current) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => store(state), SAVE_DELAY_MS);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [state]);

  const setVolume = useCallback((volume: number) => {
    dirtyRef.current = true;
    setState(withVolume(volume));
  }, []);

  const toggleMute = useCallback(() => {
    dirtyRef.current = true;
    setState(toggleMuted);
  }, []);

  return { ...state, setVolume, toggleMute };
}
