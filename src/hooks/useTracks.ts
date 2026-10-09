import { useCallback, useEffect, useRef, useState } from "react";
import { toUserMessage } from "../lib/errors";
import { forgetStream } from "../lib/resolver";
import { strings } from "../lib/strings";
import {
  deleteTrack,
  listTracks,
  restoreTrack,
  setTrackPosition,
  upsertTrack,
  type ResolvedAudio,
  type Track,
} from "../lib/tauri";

const UNDO_WINDOW_MS = 6_000;

export function useTracks() {
  const [tracks, setTracks] = useState<Track[]>([]);
  // False until the first read, so an empty library isn't announced before it is known to be empty.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDeleted, setLastDeleted] = useState<Track | null>(null);
  const undoTimerRef = useRef<number | undefined>(undefined);

  const fail = useCallback((err: unknown) => {
    setError(toUserMessage(err, strings.errors.storageFailed));
  }, []);

  useEffect(() => {
    listTracks()
      .then(setTracks, fail)
      .finally(() => setLoaded(true));
    return () => window.clearTimeout(undoTimerRef.current);
  }, [fail]);

  /** Saves a track that just resolved; returns it as stored, or null if saving failed. */
  const save = useCallback(
    async (resolved: ResolvedAudio): Promise<Track | null> => {
      try {
        const next = await upsertTrack(resolved);
        setTracks(next);
        setError(null);
        return next.find((track) => track.id === resolved.id) ?? null;
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [fail],
  );

  // Positions are saved every few seconds while playing. The list doesn't show
  // them, so they go straight to disk without touching React state: the copy
  // here would only cause a re-render, also with the popover closed.
  const savePosition = useCallback(
    async (id: string, position: number) => {
      try {
        await setTrackPosition(id, position);
      } catch (err) {
        fail(err);
      }
    },
    [fail],
  );

  const remove = useCallback(
    async (track: Track) => {
      try {
        // Undo puts back what is on disk, position included, not the copy held here.
        const stored = (await listTracks()).find((candidate) => candidate.id === track.id) ?? track;
        setTracks(await deleteTrack(track.id));
        // A removed track takes its remembered stream with it, undo or not.
        forgetStream(track.id);
        setLastDeleted(stored);
        window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = window.setTimeout(() => setLastDeleted(null), UNDO_WINDOW_MS);
      } catch (err) {
        fail(err);
      }
    },
    [fail],
  );

  const undoRemove = useCallback(async () => {
    if (!lastDeleted) return;
    window.clearTimeout(undoTimerRef.current);
    setLastDeleted(null);
    try {
      setTracks(await restoreTrack(lastDeleted));
    } catch (err) {
      fail(err);
    }
  }, [lastDeleted, fail]);

  return { tracks, loaded, error, lastDeleted, save, savePosition, remove, undoRemove };
}
