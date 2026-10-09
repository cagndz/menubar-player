import { useCallback, useEffect, type RefObject } from "react";
import { clampSeek, SKIP_SECONDS } from "../lib/mediaNavigation";
import { debugLog } from "../lib/tauri";
import type { PlayerStatus } from "./usePlayer";

interface MediaSessionOptions {
  audioRef: RefObject<HTMLAudioElement | null>;
  status: PlayerStatus;
  recovering: boolean;
  title: string | null;
  duration: number;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  /** Track navigation, shared with the buttons; null while that direction leads nowhere. */
  next: (() => void) | null;
  previous: (() => void) | null;
}

function setHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // The webview doesn't know this action; nothing to wire.
  }
}

/**
 * Connects the system media keys and Now Playing to the player. Every handler
 * goes through the player's own functions, so key presses get the same
 * expiry check, play intent and recovery as the buttons in the popover.
 */
export function useMediaSession(options: MediaSessionOptions) {
  const { audioRef, status, recovering, title, duration, play, pause, seek, next, previous } = options;
  const supported = "mediaSession" in navigator;

  useEffect(() => {
    if (!supported) return;
    navigator.mediaSession.metadata = title ? new MediaMetadata({ title, artist: "" }) : null;
  }, [supported, title]);

  // Reported on play, pause, seek and recovery; the system extrapolates in between.
  const reportPosition = useCallback(() => {
    const audio = audioRef.current;
    if (!supported || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        position: clampSeek(audio.currentTime, audio.duration),
        playbackRate: 1,
      });
    } catch (err) {
      debugLog(`[media] setPositionState failed: ${err}`);
    }
  }, [supported, audioRef]);

  useEffect(() => {
    if (!supported) return;
    navigator.mediaSession.playbackState =
      status === "playing" ? "playing" : status === "paused" ? "paused" : "none";
    reportPosition();
  }, [supported, status, recovering, duration, reportPosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.addEventListener("seeked", reportPosition);
    return () => audio.removeEventListener("seeked", reportPosition);
  }, [audioRef, reportPosition]);

  useEffect(() => {
    if (!supported) return;
    const currentTime = () => audioRef.current?.currentTime ?? 0;
    const handle = (name: string, run: () => void) => () => {
      debugLog(`[media] ${name}`);
      run();
    };

    setHandler("play", handle("play", play));
    setHandler("pause", handle("pause", pause));
    setHandler("seekforward", handle("seekforward", () => seek(currentTime() + SKIP_SECONDS)));
    setHandler("seekbackward", handle("seekbackward", () => seek(currentTime() - SKIP_SECONDS)));
    setHandler("seekto", (details) => {
      debugLog(`[media] seekto ${details.seekTime}`);
      if (details.seekTime != null) seek(details.seekTime);
    });

    return () => {
      for (const action of ["play", "pause", "seekforward", "seekbackward", "seekto"] as const) {
        setHandler(action, null);
      }
    };
  }, [supported, audioRef, play, pause, seek]);

  // Track keys are only registered while they lead somewhere, so the system
  // shows them disabled otherwise. The caller re-evaluates that whenever the
  // track, the library or the repeat mode changes.
  useEffect(() => {
    if (!supported) return;
    setHandler("nexttrack", next && (() => (debugLog("[media] nexttrack"), next())));
    setHandler("previoustrack", previous && (() => (debugLog("[media] previoustrack"), previous())));
    return () => {
      setHandler("nexttrack", null);
      setHandler("previoustrack", null);
    };
  }, [supported, next, previous]);
}
