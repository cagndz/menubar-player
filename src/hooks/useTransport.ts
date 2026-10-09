import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  afterEnded,
  availableTrackActions,
  createAdvanceGuard,
  nextTarget,
  previousTarget,
  type RepeatMode,
} from "../lib/mediaNavigation";
import { createPreloader, isPreloadDue, preloadTarget } from "../lib/preload";
import { resolveStream, reusableStream } from "../lib/resolver";
import { debugLog, type ResolvedAudio, type Track } from "../lib/tauri";

interface TransportOptions {
  audioRef: RefObject<HTMLAudioElement | null>;
  /** The library in the order the list shows it. */
  tracks: Track[];
  /** The current track, for what the UI offers. */
  trackId: string | null;
  /** The current track, read live; playback logic must not wait for a render. */
  getTrackId: () => string | null;
  repeat: RepeatMode;
  /**
   * Plays a track by its link. Knowing the track lets it be shown at once and
   * a stream resolved earlier be reused; `settle` holds the resolution until
   * the presses pause.
   */
  load: (url: string, options?: { track?: Track; settle?: boolean }) => void;
  /** Plays a track whose stream is already resolved, or being resolved. */
  playResolved: (source: ResolvedAudio | Promise<ResolvedAudio>, track?: Track) => void;
  seek: (time: number) => void;
  /** Starts the current track over and plays it. */
  restart: () => void;
}

/**
 * Track navigation: next, previous, and what follows the end of a track. The
 * buttons in the popover, the system media keys and auto-advance all use the
 * functions returned here, so they can't drift apart. It also keeps the track
 * that would come next resolved ahead of time, so the switch doesn't wait.
 */
export function useTransport(options: TransportOptions) {
  const { audioRef, tracks, trackId, getTrackId, repeat, load, playResolved, seek, restart } = options;

  // Handlers read the latest library and mode without being re-created.
  const latest = useRef({ tracks, repeat });
  latest.current = { tracks, repeat };

  const guardRef = useRef<ReturnType<typeof createAdvanceGuard> | null>(null);
  guardRef.current ??= createAdvanceGuard();
  const preloaderRef = useRef<ReturnType<typeof createPreloader> | null>(null);
  preloaderRef.current ??= createPreloader<Track>({
    // A stream resolved earlier and still good for the whole track saves the request.
    resolve: (target) => {
      const cached = reusableStream(target.id, target.duration);
      return cached ? Promise.resolve(cached) : resolveStream(target.url);
    },
  });

  // When the current stretch of uninterrupted playback began; null while not playing.
  const playingSinceRef = useRef<number | null>(null);
  const endedAtRef = useRef<number | null>(null);

  /**
   * Keeps the preload slot in step with playback. It reads the audio element
   * and refs only, never React state, and is driven by `timeupdate`: it must
   * keep working while the popover is closed and nothing is being rendered.
   */
  const updatePreload = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const { tracks, repeat } = latest.current;
    const currentId = getTrackId();
    const playingSince = playingSinceRef.current;
    preloaderRef.current?.update({
      currentId,
      target: preloadTarget(tracks, currentId, repeat),
      due: isPreloadDue({
        duration: audio.duration,
        currentTime: audio.currentTime,
        playingForMs: playingSince === null ? 0 : Date.now() - playingSince,
      }),
    });
  }, [audioRef, getTrackId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => {
      playingSinceRef.current = Date.now();
    };
    const onInterrupted = () => {
      playingSinceRef.current = null;
    };
    const interruptions = ["pause", "waiting", "ended", "emptied"] as const;

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("timeupdate", updatePreload);
    for (const name of interruptions) audio.addEventListener(name, onInterrupted);
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", updatePreload);
      for (const name of interruptions) audio.removeEventListener(name, onInterrupted);
    };
  }, [audioRef, updatePreload]);

  // A change of library, order, mode or current track may leave the slot
  // holding the wrong track: re-evaluate right away rather than at the next tick.
  const order = tracks.map((track) => track.id).join(",");
  useEffect(updatePreload, [updatePreload, order, repeat, trackId]);

  /**
   * Changes to another track, using its preloaded stream when there is one
   * for this switch. `settle` is for presses of "next": several in a row
   * resolve only the track they end on.
   */
  const goTo = useCallback(
    (target: Track, settle: boolean) => {
      const preloaded = preloaderRef.current?.take(getTrackId(), target.id, Date.now()) ?? null;
      if (preloaded?.kind === "ready") {
        debugLog(`[transport] ${target.id}: using the preloaded stream`);
        playResolved(preloaded.resolved, target);
      } else if (preloaded?.kind === "pending") {
        debugLog(`[transport] ${target.id}: waiting for the preload in flight`);
        playResolved(preloaded.promise, target);
      } else {
        load(target.url, { track: target, settle });
      }
    },
    [getTrackId, load, playResolved],
  );

  const next = useCallback(() => {
    const { tracks, repeat } = latest.current;
    const target = nextTarget(tracks, getTrackId(), repeat);
    debugLog(`[transport] next -> ${target?.id ?? "nothing"}`);
    if (target) goTo(target, true);
  }, [getTrackId, goTo]);

  const previous = useCallback(() => {
    const { tracks, repeat } = latest.current;
    const target = previousTarget(tracks, getTrackId(), audioRef.current?.currentTime ?? 0, repeat);
    debugLog(`[transport] previous -> ${target.kind === "track" ? target.track.id : "restart"}`);
    if (target.kind === "track") {
      load(target.track.url, { track: target.track, settle: true });
    } else {
      seek(0);
    }
  }, [audioRef, getTrackId, load, seek]);

  /** To be called when audio actually starts playing. */
  const handlePlaying = useCallback(() => {
    guardRef.current?.onPlaying();
    if (endedAtRef.current !== null) {
      debugLog(`[transport] gap between tracks: ${Date.now() - endedAtRef.current} ms`);
      endedAtRef.current = null;
    }
  }, []);

  /** To be called when a track plays to its end; advances at most once per real playback. */
  const handleEnded = useCallback(() => {
    if (!guardRef.current?.onEnded()) {
      debugLog("[transport] ended ignored: nothing played since the last advance");
      return;
    }
    const { tracks, repeat } = latest.current;
    const action = afterEnded(tracks, getTrackId(), repeat);
    debugLog(`[transport] ended (repeat ${repeat}) -> ${action.kind === "play" ? action.track.id : action.kind}`);
    endedAtRef.current = action.kind === "stop" ? null : Date.now();
    switch (action.kind) {
      case "restart":
        restart();
        break;
      case "play":
        goTo(action.track, false);
        break;
      case "stop":
        // Leave the finished track parked at its start.
        seek(0);
        break;
    }
  }, [getTrackId, goTo, seek, restart]);

  const available = availableTrackActions(tracks, trackId, repeat);

  return { next, previous, canNext: available.next, canPrevious: available.previous, handlePlaying, handleEnded };
}
