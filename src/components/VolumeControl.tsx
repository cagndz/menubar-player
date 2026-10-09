import type { KeyboardEvent } from "react";
import { strings } from "../lib/strings";
import { clampVolume, MAX_VOLUME, MIN_VOLUME, stepVolume, VOLUME_STEP, volumeLevel } from "../lib/volume";
import { VolumeHighIcon, VolumeLowIcon, VolumeMutedIcon } from "./icons";
import { Slider } from "./Slider";

interface VolumeControlProps {
  /** 0 to 100; kept while muted. */
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  /** Preview only: "open" draws the slider without the pointer over it. */
  force?: string;
}

const LEVEL_ICON = { muted: VolumeMutedIcon, low: VolumeLowIcon, high: VolumeHighIcon };

/**
 * The button mutes; a vertical slider opens above it while the pointer or the
 * keyboard focus is on either of them, so it takes no room otherwise.
 */
export function VolumeControl({ volume, muted, onVolumeChange, onToggleMute, force }: VolumeControlProps) {
  const level = volumeLevel({ volume, muted });
  const LevelIcon = LEVEL_ICON[level];
  // What can be heard right now: a muted slider sits at 0 but remembers its level.
  const shown = muted ? MIN_VOLUME : volume;

  // Arrows move in steps of 5; dragging keeps the slider's own resolution.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    onVolumeChange(stepVolume(shown, direction * VOLUME_STEP));
  };

  return (
    <div data-level={level} data-force={force} className="volume">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={level === "muted" ? strings.volume.unmute(volume) : strings.volume.mute(volume)}
        aria-pressed={muted}
        className="icon-button"
      >
        <LevelIcon />
      </button>
      <div className="volume-flyout">
        <Slider
          value={shown}
          max={MAX_VOLUME}
          orientation="vertical"
          live
          onCommit={(value) => onVolumeChange(clampVolume(value))}
          inputProps={{
            step: 1,
            value: shown,
            "aria-label": strings.volume.slider(shown),
            "aria-valuetext": strings.volume.percent(shown),
            onChange: (event) => onVolumeChange(Number(event.target.value)),
            onKeyDown: handleKeyDown,
          }}
        />
      </div>
    </div>
  );
}
