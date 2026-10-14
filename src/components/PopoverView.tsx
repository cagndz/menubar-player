import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { DURATION_ENTER, DURATION_EXIT, EASE_OUT, useReducedMotion } from "../lib/motion";
import { strings } from "../lib/strings";
import { ErrorText } from "./ErrorText";
import { MarqueeText } from "./MarqueeText";
import { ScrollArea } from "./ScrollArea";

interface PopoverViewProps {
  /** The URL field. */
  urlInput: ReactNode;
  /** Outcome of the last "Add", shown under the field. */
  addNotice: { kind: "info" | "error"; text: string } | null;
  /** The list of tracks; absent until the library has been read. */
  list: ReactNode;
  libraryError: string | null;
  /** Offered for a few seconds after removing a track. */
  onUndo: (() => void) | null;
  /** Title of the track loaded or loading, if any. */
  title: string | null;
  /** "Loading…" or "Reconnecting…", for assistive technology; on screen the play button shows it. */
  statusLabel: string | null;
  error: string | null;
  onRetry: (() => void) | null;
  /** Counter, ruler and buttons. */
  controls: ReactNode;
  /** Development aids, below everything else. */
  devTools?: ReactNode;
}

/**
 * The popover as a layout: field on top, library in the middle, player docked
 * at the bottom. It holds no state, so the preview page can draw every
 * situation with it.
 */
export function PopoverView(props: PopoverViewProps) {
  const { urlInput, addNotice, list, libraryError, onUndo, title, statusLabel, error, onRetry, controls, devTools } = props;
  const reducedMotion = useReducedMotion();

  return (
    <main className="popover">
      <header className="flex flex-col gap-1.5 px-3 pt-3 pb-2">
        {urlInput}
        {addNotice && (
          <p role={addNotice.kind === "error" ? "alert" : "status"} className="notice" data-kind={addNotice.kind}>
            <ErrorText text={addNotice.text} />
          </p>
        )}
      </header>

      <section className="flex min-h-0 flex-1 flex-col px-1">
        <p className="caps px-2 py-1">{strings.library.heading}</p>
        {libraryError && (
          <p role="alert" className="error-block mx-2 mb-1">
            <ErrorText text={libraryError} />
          </p>
        )}
        <ScrollArea>{list}</ScrollArea>
      </section>

      {/* The one thing that slides: it arrives after an action and leaves by itself.
          With reduced motion it only fades. */}
      <AnimatePresence initial={false}>
        {onUndo && (
          <motion.p
            role="status"
            className="notice px-3 py-1.5"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION_ENTER, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: DURATION_EXIT, ease: EASE_OUT } }}
          >
            {strings.library.removed}
            {strings.library.removedSeparator}
            <button type="button" onClick={onUndo} className="text-button">
              {strings.library.undo}
            </button>
          </motion.p>
        )}
      </AnimatePresence>

      <footer className="player flex flex-col gap-1.5 px-3 pt-2 pb-3">
        {error && (
          <p role="alert" className="error-block">
            <ErrorText text={error} />
            {onRetry && (
              <>
                {" "}
                <button type="button" onClick={onRetry} className="text-button">
                  {strings.actions.retry}
                </button>
              </>
            )}
          </p>
        )}
        {/* The title sits centred over the player, no wider than the progress bar below it. */}
        <div>
          <p data-slot="track-title" data-marquee-host className="player-title">
            {title ? (
              <MarqueeText text={title} className="font-medium" />
            ) : (
              // Holds the title's place, so the popover keeps its layout with nothing loaded.
              <span className="text-text-muted">{strings.controls.nothingPlaying}</span>
            )}
          </p>
          <p role="status" className="sr-only">
            {statusLabel}
          </p>
        </div>
        {controls}
        {devTools}
      </footer>
    </main>
  );
}
