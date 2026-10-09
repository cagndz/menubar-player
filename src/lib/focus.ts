const FOCUSABLE = "input:not([disabled]), button:not([disabled]), [tabindex]";

/** Elements Tab stops at inside `root`, in order. */
export function tabStops(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.tabIndex >= 0);
}

/**
 * Keeps Tab cycling inside `root`: past the last stop it goes back to the
 * first (and the reverse with Shift), instead of leaving the document for a
 * stop with nothing focused. Returns true when it moved the focus itself.
 */
export function wrapTab(root: ParentNode, backwards: boolean): boolean {
  const stops = tabStops(root);
  if (stops.length === 0) return false;

  const index = stops.indexOf(document.activeElement as HTMLElement);
  const last = stops.length - 1;
  if (backwards && index <= 0) {
    stops[last].focus();
    return true;
  }
  if (!backwards && (index === -1 || index === last)) {
    stops[0].focus();
    return true;
  }
  return false;
}
