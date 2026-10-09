import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { DURATION_ENTER, DURATION_EXIT, EASE_OUT } from "../lib/motion";
import { strings } from "../lib/strings";

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

  return (
    <main className="popover">
      <header className="flex flex-col gap-1.5 px-3 pt-3 pb-2">
        {urlInput}
        {addNotice && (
          <p role={addNotice.kind === "error" ? "alert" : "status"} className="notice" data-kind={addNotice.kind}>
            {addNotice.text}
          </p>
        )}
      </header>

      <section className="flex min-h-0 flex-1 flex-col px-1">
        <p className="caps px-2 py-1">{strings.library.heading}</p>
        {libraryError && (
          <p role="alert" className="error-block mx-2 mb-1">
            {libraryError}
          </p>
        )}
        <div className="scroll-area min-h-0 flex-1 overflow-y-auto">{list}</div>
      </section>

      {/* The one thing that slides: it arrives after an action and leaves by itself. */}
      <AnimatePresence initial={false}>
        {onUndo && (
          <motion.p
            role="status"
            className="notice px-3 py-1.5"
            initial={{ opacity: 0, y: 4 }}
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

      <footer className="flex flex-col gap-1.5 border-t border-line px-3 pt-2 pb-3">
        {error && (
          <p role="alert" className="error-block">
            {error}
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
        {/* The title sits centred over the player. */}
        <div className="flex min-h-[18px] flex-col items-center text-center">
          <p data-slot="track-title" className="max-w-full truncate font-medium">
            {title}
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
