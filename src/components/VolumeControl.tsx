import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { strings } from "../lib/strings";
import { clampVolume, MAX_VOLUME, MIN_VOLUME, stepVolume, VOLUME_STEP, volumeLevel } from "../lib/volume";
import { VolumeHighIcon, VolumeLowIcon, VolumeMutedIcon } from "./icons";
import { Slider } from "./Slider";

/** Grace before the slider hides once the pointer leaves, so crossing a seam doesn't make it blink. */
const HIDE_DELAY_MS = 150;

interface VolumeControlProps {
  /** 0 to 100; kept while muted. */
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  /** Preview only: "open" draws the slider shown. */
  force?: string;
}

const LEVEL_ICON = { muted: VolumeMutedIcon, low: VolumeLowIcon, high: VolumeHighIcon };

/**
 * The button mutes. A horizontal slider shows to its right while the pointer
 * is on either of them or the keyboard focus is inside; it takes no room of
 * its own, filling the space the player leaves after the button.
 *
 * The root is `display: contents`: the button and the slider are laid out by
 * the player's grid, the slider in the column that runs to the edge.
 */
export function VolumeControl({ volume, muted, onVolumeChange, onToggleMute, force }: VolumeControlProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Escape hides the slider while the focus stays on the button; leaving undoes it.
  const [dismissed, setDismissed] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const shown = force === "open" || (!dismissed && (hovered || focused));

  const level = volumeLevel({ volume, muted });
  const LevelIcon = LEVEL_ICON[level];
  // What can be heard right now: a muted slider sits at 0 but remembers its level.
  const audible = muted ? MIN_VOLUME : volume;

  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  const pointerIn = () => {
    window.clearTimeout(hideTimerRef.current);
    setHovered(true);
  };
  const pointerOut = () => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setHovered(false);
      setDismissed(false);
    }, HIDE_DELAY_MS);
  };

  // Arrows move in steps of 5; dragging keeps the slider's own resolution.
  const handleSliderKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    onVolumeChange(stepVolume(audible, direction * VOLUME_STEP));
  };

  return (
    <div
      className="volume"
      data-level={level}
      data-open={shown}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFocused(false);
        setDismissed(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !shown) return;
        setDismissed(true);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggleMute}
        onPointerEnter={pointerIn}
        onPointerLeave={pointerOut}
        aria-label={strings.volume.mute}
        aria-pressed={muted}
        className="icon-button ml-3"
      >
        <LevelIcon />
      </button>
      {/* Starts right at the button's edge, so the pointer never crosses a gap. */}
      <div className="volume-slider" inert={!shown} onPointerEnter={pointerIn} onPointerLeave={pointerOut}>
        <Slider
          value={audible}
          max={MAX_VOLUME}
          live
          onCommit={(value) => onVolumeChange(clampVolume(value))}
          inputProps={{
            step: 1,
            value: audible,
            "aria-label": strings.volume.slider(audible),
            "aria-valuetext": strings.volume.percent(audible),
            onChange: (event) => onVolumeChange(Number(event.target.value)),
            onKeyDown: handleSliderKeyDown,
          }}
        />
      </div>
    </div>
  );
}
