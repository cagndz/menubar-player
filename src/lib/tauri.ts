import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TrayAction, TrayMenu } from "./trayMenu";

export interface ResolvedAudio {
  id: string;
  title: string;
  /** Seconds; 0 when unknown. */
  duration: number;
  /** Canonical watch URL. */
  pageUrl: string;
  /** Short-lived direct URL of the HLS playlist. */
  streamUrl: string;
  /** Unix time (seconds) at which `streamUrl` stops working; null when unknown. */
  expiresAt: number | null;
}

export interface Track {
  id: string;
  url: string;
  title: string;
  /** Seconds; 0 when unknown. */
  duration: number;
  /** Seconds. */
  position: number;
  addedAt: string;
  lastPlayedAt: string;
}

/** Shape of every command rejection; `detail` is technical and only meant for the log. */
export interface AppError {
  code: string;
  detail: string | null;
}

export function resolveAudio(url: string): Promise<ResolvedAudio> {
  return invoke<ResolvedAudio>("resolve_audio", { url });
}

/** Whether YouTube answers at all; false means a connection problem, not an expired stream. */
export function checkConnectivity(): Promise<boolean> {
  return invoke<boolean>("check_connectivity");
}

export function listTracks(): Promise<Track[]> {
  return invoke<Track[]>("list_tracks");
}

export function upsertTrack(resolved: ResolvedAudio): Promise<Track[]> {
  return invoke<Track[]>("upsert_track", {
    id: resolved.id,
    url: resolved.pageUrl,
    title: resolved.title,
    duration: resolved.duration,
  });
}

export function setTrackPosition(id: string, position: number): Promise<void> {
  return invoke("set_track_position", { id, position });
}

export function deleteTrack(id: string): Promise<Track[]> {
  return invoke<Track[]>("delete_track", { id });
}

export function restoreTrack(track: Track): Promise<Track[]> {
  return invoke<Track[]>("restore_track", { track });
}

/** Tells the menu bar icon whether something is playing (level bars) or not (pause sign). */
export function setTrayState(playing: boolean): Promise<void> {
  return invoke("set_tray_state", { playing });
}

/** Updates the menu behind a right click on the menu bar icon. */
export function setTrayMenu(menu: TrayMenu): Promise<void> {
  return invoke("set_tray_menu", { menu });
}

/** Fires when play/pause or next is chosen in the tray menu; returns the unsubscribe function. */
export function onTrayAction(handler: (action: TrayAction) => void): () => void {
  const unlisten = listen<TrayAction>("tray-action", (event) => handler(event.payload));
  return () => void unlisten.then((stop) => stop());
}

/** Opens the popover under the menu bar icon, as a click on it would. */
export function showPopover(): Promise<void> {
  return invoke("show_popover");
}

export function hidePopover(): Promise<void> {
  return invoke("hide_popover");
}

export function quitApp(): Promise<void> {
  return invoke("quit_app");
}

/** Fires when "Quit" is chosen in the tray menu; returns the unsubscribe function. */
export function onQuitRequested(handler: () => void): () => void {
  const unlisten = listen("quit-requested", handler);
  return () => void unlisten.then((stop) => stop());
}

/** Logs to the webview console and, in dev, to the `tauri dev` terminal. */
export function debugLog(message: string): void {
  console.log(message);
  if (import.meta.env.DEV) {
    void invoke("frontend_log", { message }).catch(() => {});
  }
}
