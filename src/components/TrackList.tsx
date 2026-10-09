import { useReducedMotion } from "motion/react";
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { formatTime } from "../lib/format";
import { strings } from "../lib/strings";
import { PlayIcon, PlayPauseIcon, RemoveIcon } from "./icons";
import type { Track } from "../lib/tauri";

export interface TrackListHandle {
  /** Focuses the first row; returns false when the list is empty. */
  focusFirst: () => boolean;
  /** Focuses the row of the given track, if it is listed. */
  focusRow: (id: string) => void;
  /** Scrolls the row of the given track into view, once it is listed. */
  revealRow: (id: string) => void;
}

interface TrackListProps {
  ref?: Ref<TrackListHandle>;
  tracks: Track[];
  currentId: string | null;
  /** Whether the current track is playing (as opposed to paused or stopped). */
  playing: boolean;
  onPlay: (track: Track) => void;
  onDelete: (track: Track) => void;
  /** Arrow up on the first row leaves the list towards whatever is above it. */
  onExitUp: () => void;
  /** Preview only: draw a state on a row without the real input, keyed by track id. */
  force?: Record<string, string>;
}

export function TrackList(props: TrackListProps) {
  const { ref, tracks, currentId, playing, onPlay, onDelete, onExitUp, force } = props;
  // Roving tabindex: Tab reaches the list once, the arrow keys move inside it.
  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Row to focus once the list re-renders after a keyboard delete.
  const focusAfterUpdateRef = useRef<number | null>(null);
  // Track to scroll to; it may be asked for before the list has its row.
  const [revealId, setRevealId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  useImperativeHandle(
    ref,
    () => ({
      focusFirst: () => {
        rowRefs.current[0]?.focus();
        return tracks.length > 0;
      },
      focusRow: (id) => {
        rowRefs.current[tracks.findIndex((track) => track.id === id)]?.focus();
      },
      revealRow: setRevealId,
    }),
    [tracks],
  );

  useEffect(() => {
    const index = focusAfterUpdateRef.current;
    if (index === null) return;
    focusAfterUpdateRef.current = null;
    if (tracks.length === 0) {
      onExitUp();
    } else {
      rowRefs.current[Math.min(index, tracks.length - 1)]?.focus();
    }
  }, [tracks, onExitUp]);

  useEffect(() => {
    if (revealId === null) return;
    const index = tracks.findIndex((track) => track.id === revealId);
    if (index === -1) return;
    setRevealId(null);
    rowRefs.current[index]?.scrollIntoView?.({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [revealId, tracks, reducedMotion]);

  if (tracks.length === 0) {
    return <p className="notice px-2 py-1">{strings.library.empty}</p>;
  }

  const tabbableIndex = Math.min(activeIndex, tracks.length - 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number, track: Track) => {
    // Keys pressed on one of the row's own buttons are that button's business.
    if (event.target !== event.currentTarget) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        rowRefs.current[Math.min(index + 1, tracks.length - 1)]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        if (index === 0) {
          onExitUp();
        } else {
          rowRefs.current[index - 1]?.focus();
        }
        break;
      case "Enter":
        event.preventDefault();
        onPlay(track);
        break;
      // Mac keyboards send Backspace for the key labelled "delete".
      case "Delete":
      case "Backspace":
        event.preventDefault();
        focusAfterUpdateRef.current = index;
        onDelete(track);
        break;
    }
  };

  return (
    <ul aria-label={strings.library.heading} className="flex flex-col">
      {tracks.map((track, index) => {
        const isCurrent = track.id === currentId;
        const rowState = !isCurrent ? "idle" : playing ? "playing" : "paused";

        return (
          <li
            key={track.id}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            tabIndex={index === tabbableIndex ? 0 : -1}
            aria-current={isCurrent ? "true" : undefined}
            data-state={rowState}
            data-force={force?.[track.id]}
            onFocus={() => setActiveIndex(index)}
            onClick={() => onPlay(track)}
            onKeyDown={(event) => handleKeyDown(event, index, track)}
            className="row"
          >
            {/* No handler of its own: the click reaches the row, which does the same thing. */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={rowState === "playing" ? strings.library.pause(track.title) : strings.library.play(track.title)}
              className="row-icon"
            >
              {isCurrent ? <PlayPauseIcon playing={rowState === "playing"} /> : <PlayIcon />}
            </button>
            <span className="min-w-0 flex-1 truncate">{track.title}</span>
            {track.duration > 0 && <span className="row-duration">{formatTime(track.duration)}</span>}
            {/* Always takes its space, so appearing on hover never shifts the title. */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={strings.library.remove}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(track);
              }}
              className="row-remove"
            >
              <RemoveIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
