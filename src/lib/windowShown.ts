/**
 * Marks the document while the popover is out of sight, as
 * `<html data-window="hidden">`, so CSS can stop what loops (the level bars).
 * The window keeps running when hidden (background throttling is off, for the
 * audio), so nothing else would stop them.
 *
 * The popover is a panel that is hidden whenever it loses the keyboard, so
 * focus is the signal; visibility is checked as well, in case the system
 * reports it.
 */
export function trackWindowShown(root: HTMLElement = document.documentElement): () => void {
  const update = () => {
    root.dataset.window = document.hasFocus() && !document.hidden ? "shown" : "hidden";
  };
  update();
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  document.addEventListener("visibilitychange", update);
  return () => {
    window.removeEventListener("focus", update);
    window.removeEventListener("blur", update);
    document.removeEventListener("visibilitychange", update);
  };
}
