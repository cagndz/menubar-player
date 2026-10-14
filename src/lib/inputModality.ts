// Whether the last thing the user did was press a key or point, the same
// distinction the browser makes for :focus-visible. CSS uses :focus-visible
// itself; script that must agree with it (the scrolling titles) asks here.

let keyboard = false;
let listening = false;

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener(
    "keydown",
    (event) => {
      // Shortcuts like ⌘V are not keyboard navigation.
      if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboard = true;
    },
    true,
  );
  for (const type of ["pointerdown", "mousedown", "touchstart"]) {
    document.addEventListener(type, () => (keyboard = false), true);
  }
}

listen();

/** True when the focus was last moved from the keyboard, as :focus-visible would show it. */
export function focusIsFromKeyboard(): boolean {
  return keyboard;
}
