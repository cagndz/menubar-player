// The icon set: 16 px glyphs in one style.
// Solid shapes with softly rounded corners for transport, a 1.5 px rounded
// line for everything else. Purely decorative: the button carries the label.

import { motion, useReducedMotion } from "motion/react";
import { DURATION_MORPH, EASE_IN_OUT } from "../lib/motion";

const box = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true } as const;
/** Solid shape whose corners are rounded by a stroke of the same colour. */
const solid = { fill: "currentColor", stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" } as const;
const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

// Play and pause are the same two shapes: each half of the triangle becomes
// one of the bars. Four points apiece, in the same order, so one can turn into
// the other.
const PLAY_LEFT = "M5.25 3.75 L8.625 5.875 L8.625 10.125 L5.25 12.25 Z";
const PLAY_RIGHT = "M8.625 5.875 L12 8 L12 8 L8.625 10.125 Z";
const PAUSE_LEFT = "M4.75 3.75 L6.25 3.75 L6.25 12.25 L4.75 12.25 Z";
const PAUSE_RIGHT = "M9.75 3.75 L11.25 3.75 L11.25 12.25 L9.75 12.25 Z";

export function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...box} width={size} height={size} {...solid}>
      <path d={PLAY_LEFT} />
      <path d={PLAY_RIGHT} />
    </svg>
  );
}

export function PauseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...box} width={size} height={size} {...solid}>
      <path d={PAUSE_LEFT} />
      <path d={PAUSE_RIGHT} />
    </svg>
  );
}

/**
 * Play or pause, morphing from one to the other when `playing` changes. With
 * reduced motion the shape simply switches.
 */
export function PlayPauseIcon({ playing, size = 16 }: { playing: boolean; size?: number }) {
  const reduced = useReducedMotion();
  const transition = { duration: reduced ? 0 : DURATION_MORPH, ease: EASE_IN_OUT };

  return (
    <svg {...box} width={size} height={size} {...solid}>
      <motion.path initial={false} animate={{ d: playing ? PAUSE_LEFT : PLAY_LEFT }} transition={transition} />
      <motion.path initial={false} animate={{ d: playing ? PAUSE_RIGHT : PLAY_RIGHT }} transition={transition} />
    </svg>
  );
}

/** A ring with a brighter arc that goes round it, for waiting. The turning is CSS (`.spinner`). */
export function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...box} width={size} height={size} {...line} className="spinner">
      <circle cx="8" cy="8" r="5.25" opacity="0.25" />
      <path d="M8 2.75a5.25 5.25 0 0 1 5.25 5.25" />
    </svg>
  );
}

export function PreviousIcon() {
  return (
    <svg {...box} {...solid}>
      <path d="M12.25 4.25v7.500L6.750 8z" />
      <path d="M3.750 4.250v7.500" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function NextIcon() {
  return (
    <svg {...box} {...solid}>
      <path d="M3.750 4.250v7.500L9.250 8z" />
      <path d="M12.250 4.250v7.500" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function RemoveIcon() {
  return (
    <svg {...box} {...line}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

const loop = "M3 7.250V6.500a2 2 0 0 1 2-2h7.250M10.500 2.750 12.250 4.500 10.500 6.250M13 8.750v.750a2 2 0 0 1-2 2H3.750M5.500 13.250 3.750 11.500 5.500 9.750";

/** Loop arrows, faded and crossed out. */
export function RepeatOffIcon() {
  return (
    <svg {...box} {...line}>
      <path d={loop} opacity="0.4" />
      <path d="M2.750 2.750l10.500 10.500" />
    </svg>
  );
}

/** Plain loop arrows. */
export function RepeatAllIcon() {
  return (
    <svg {...box} {...line}>
      <path d={loop} />
    </svg>
  );
}

/** Loop arrows around a "1". */
export function RepeatOneIcon() {
  return (
    <svg {...box} {...line}>
      <path d={loop} />
      <path d="M7.400 7.150 8.250 6.650V9.500" strokeWidth="1.25" />
    </svg>
  );
}

const speaker = "M2.750 6.250h1.750L7.750 3.750v8.500L4.500 9.750H2.750z";

/** Speaker with a cross. */
export function VolumeMutedIcon() {
  return (
    <svg {...box} {...line}>
      <path d={speaker} fill="currentColor" />
      <path d="M10.500 6.500l3 3M13.500 6.500l-3 3" />
    </svg>
  );
}

/** Speaker with one wave. */
export function VolumeLowIcon() {
  return (
    <svg {...box} {...line}>
      <path d={speaker} fill="currentColor" />
      <path d="M10.250 6.250a2.500 2.500 0 0 1 0 3.500" />
    </svg>
  );
}

/** Speaker with two waves. */
export function VolumeHighIcon() {
  return (
    <svg {...box} {...line}>
      <path d={speaker} fill="currentColor" />
      <path d="M10.250 6.250a2.500 2.500 0 0 1 0 3.500M12.250 4.250a5.250 5.250 0 0 1 0 7.500" />
    </svg>
  );
}
