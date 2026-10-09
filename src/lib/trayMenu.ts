import type { PlayerStatus } from "../hooks/usePlayer";
import type { Track } from "./tauri";

/** What the menu behind a right click on the menu bar icon shows. */
export interface TrayMenu {
  /** The track loaded in the player, shown as a heading; null hides it. */
  title: string | null;
  /** The play/pause item reads "Pause". */
  playing: boolean;
  canToggle: boolean;
  canNext: boolean;
}

export type TrayAction = "toggle" | "next";

interface PlayerSnapshot {
  status: PlayerStatus;
  recovering: boolean;
  title: string | null;
  libraryIsEmpty: boolean;
  canNext: boolean;
}

export function trayMenu({ status, recovering, title, libraryIsEmpty, canNext }: PlayerSnapshot): TrayMenu {
  const active = status === "playing" || status === "paused";
  // While a track is being resolved, another press would only queue more requests.
  const busy = recovering || status === "loading";
  return {
    title,
    playing: status === "playing",
    canToggle: !busy && (active || !libraryIsEmpty),
    canNext: !busy && canNext,
  };
}

/**
 * The track "Play" starts when nothing is loaded: the one the player was on,
 * or else the one played most recently. A track that was never played counts
 * from when it was added, so a fresh library starts with its newest track.
 */
export function trackToStart(tracks: Track[], currentId: string | null): Track | null {
  const current = tracks.find((track) => track.id === currentId);
  if (current) return current;
  // The library comes newest last, so on a tie the last one wins.
  return tracks.reduce<Track | null>(
    (latest, track) => (latest && latest.lastPlayedAt > track.lastPlayedAt ? latest : track),
    null,
  );
}
