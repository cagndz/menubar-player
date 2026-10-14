import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
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
  /** Preview only: "open" draws the panel open. */
  force?: string;
}

const LEVEL_ICON = { muted: VolumeMutedIcon, low: VolumeLowIcon, high: VolumeHighIcon };

/**
 * The button opens a small panel above the player with a vertical slider and
 * a mute toggle. A click outside, Escape or the focus leaving closes it; the
 * button's icon shows the level, muted included, while it is closed.
 */
export function VolumeControl({ volume, muted, onVolumeChange, onToggleMute, force }: VolumeControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const shownOpen = open || force === "open";

  const level = volumeLevel({ volume, muted });
  const LevelIcon = LEVEL_ICON[level];
  // What can be heard right now: a muted slider sits at 0 but remembers its level.
  const shown = muted ? MIN_VOLUME : volume;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    // Escape closes the panel and nothing else; the focus goes back to the button.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    // Hiding the popover is a way of leaving too.
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  // Arrows move in steps of 5; dragging keeps the slider's own resolution.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    onVolumeChange(stepVolume(shown, direction * VOLUME_STEP));
  };

  return (
    <div
      ref={rootRef}
      data-level={level}
      data-open={shownOpen}
      className="volume"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={strings.volume.button(volume, muted)}
        aria-expanded={shownOpen}
        aria-controls={panelId}
        className="icon-button"
      >
        <LevelIcon />
      </button>
      <div id={panelId} className="volume-flyout" inert={!shownOpen}>
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
        <button type="button" onClick={onToggleMute} aria-label={strings.volume.mute} aria-pressed={muted} className="icon-button">
          <VolumeMutedIcon />
        </button>
      </div>
    </div>
  );
}
