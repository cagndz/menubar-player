// Motion values for JavaScript (Motion wants cubic-bezier curves as arrays).
// They mirror the --ease-* and --duration-* tokens in index.css: change both.

type Bezier = [number, number, number, number];

/** Entering and leaving: fast start, gentle settle. */
export const EASE_OUT: Bezier = [0.19, 1, 0.22, 1];
/** A change of shape that stays on screen, like play turning into pause. */
export const EASE_IN_OUT: Bezier = [0.645, 0.045, 0.355, 1];

/** Seconds. */
export const DURATION_MORPH = 0.18;
export const DURATION_ENTER = 0.18;
export const DURATION_EXIT = 0.12;
