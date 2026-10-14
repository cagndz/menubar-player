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
      {/* design/icons/tray-playing.svg, with the 1 px margin of its 18 px box cropped off. */}
      <svg width="16" height="16" viewBox="1 1 16 16" fill="currentColor" aria-hidden="true">
        <rect x="3.5" y="8" width="2.5" height="7" rx="1.25" />
        <rect x="7.75" y="3" width="2.5" height="12" rx="1.25" />
        <rect x="12" y="6" width="2.5" height="9" rx="1.25" />
      </svg>
    </span>
  );
}
