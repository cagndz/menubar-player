import { strings } from "../lib/strings";

/**
 * The menu bar icon's three level bars, as the state of the current track.
 * They move while it plays and hold still where they are in pause; the motion
 * itself is all CSS (`.level-bars` in index.css).
 */
export function LevelBars({ playing }: { playing: boolean }) {
  return (
    <span
      role="img"
      aria-label={playing ? strings.library.nowPlaying : strings.library.paused}
      className="level-bars"
      data-playing={playing}
    >
      {/* design/icons/tray-playing.svg, drawn as boxes rather than SVG so the
          compositor can animate them without repainting (see index.css). */}
      <span className="level-bars-glyph" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
