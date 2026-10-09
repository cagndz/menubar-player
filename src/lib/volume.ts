// Volume rules, kept apart from React and from the audio element.

export const MIN_VOLUME = 0;
export const MAX_VOLUME = 100;
const DEFAULT_VOLUME = 100;
/** How far the arrow keys move the slider. */
export const VOLUME_STEP = 5;

export interface VolumeState {
  /** 0 to 100. Muting leaves it untouched, so unmuting brings it back. */
  volume: number;
  muted: boolean;
}

export type VolumeLevel = "muted" | "low" | "high";

const DEFAULT_VOLUME_STATE: VolumeState = { volume: DEFAULT_VOLUME, muted: false };

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(Math.max(Math.round(value), MIN_VOLUME), MAX_VOLUME);
}

/** Moves the volume by `delta`, staying within 0 and 100. */
export function stepVolume(volume: number, delta: number): number {
  return clampVolume(volume + delta);
}

/** What the audio element should be set to, from 0 to 1. */
export function effectiveVolume({ volume, muted }: VolumeState): number {
  return muted ? 0 : clampVolume(volume) / MAX_VOLUME;
}

/** Which icon describes the sound right now. */
export function volumeLevel({ volume, muted }: VolumeState): VolumeLevel {
  if (muted || volume <= MIN_VOLUME) return "muted";
  return volume < 50 ? "low" : "high";
}

/** Changing the level by hand also unmutes: moving the slider is asking for sound. */
export function withVolume(volume: number): VolumeState {
  return { volume: clampVolume(volume), muted: false };
}

/**
 * Mutes, or unmutes back to the level there was. Unmuting from a level of 0
 * would stay silent, so it goes to the default instead.
 */
export function toggleMuted(state: VolumeState): VolumeState {
  if (!state.muted && state.volume > MIN_VOLUME) return { ...state, muted: true };
  return { volume: state.volume > MIN_VOLUME ? state.volume : DEFAULT_VOLUME, muted: false };
}

/** Reads what was stored, falling back to the default for anything unexpected. */
export function parseVolumeState(raw: string | null): VolumeState {
  if (raw === null) return DEFAULT_VOLUME_STATE;
  try {
    const stored = JSON.parse(raw) as Partial<VolumeState> | null;
    if (typeof stored !== "object" || stored === null || typeof stored.volume !== "number") return DEFAULT_VOLUME_STATE;
    return { volume: clampVolume(stored.volume), muted: stored.muted === true };
  } catch {
    return DEFAULT_VOLUME_STATE;
  }
}
