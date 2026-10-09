import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PlayerStatus } from "../hooks/usePlayer";
import { formatTime } from "../lib/format";
import type { RepeatMode } from "../lib/mediaNavigation";
import { strings } from "../lib/strings";
import { NextIcon, PlayPauseIcon, PreviousIcon, RepeatAllIcon, RepeatOffIcon, RepeatOneIcon, SpinnerIcon } from "./icons";
import { Slider } from "./Slider";

const SEEK_STEP_SECONDS = 1;
const SEEK_STEP_LARGE_SECONDS = 10;
/** A change of position larger than this is a jump, not playback moving on. */
const SMOOTH_STEP_LIMIT_SECONDS = 1.5;

interface PlayerControlsProps {
  status: PlayerStatus;
  /** The stream is being re-resolved; the play button and the progress bar show it. */
  recovering?: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSeek: (time: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  repeat: RepeatMode;
  onCycleRepeat: () => void;
  /** Rendered after the repeat button, at the right (the volume). */
  children?: ReactNode;
}

const REPEAT_ICON = { off: RepeatOffIcon, all: RepeatAllIcon, one: RepeatOneIcon };

export function PlayerControls(props: PlayerControlsProps) {
  const { status, recovering = false, currentTime, duration, onToggle, onSeek } = props;
  const { onPrevious, onNext, canPrevious, canNext, repeat, onCycleRepeat, children } = props;
  const RepeatIcon = REPEAT_ICON[repeat];
  // While dragging or stepping, the bar follows the hand instead of playback.
  const [scrub, setScrub] = useState<number | null>(null);

  const active = status === "playing" || status === "paused";
  const seekable = active && Number.isFinite(duration) && duration > 0;
  const position = scrub ?? currentTime;
  // Waiting on the stream: the play button shows it, where the press just happened.
  const waiting = status === "loading" || recovering;

  // The position arrives once a second; while it only moves on by that second,
  // the bar glides to it. A seek, a new track or reopening the popover is a
  // jump, and a jump is shown at once.
  const lastPositionRef = useRef(position);
  const steppedOn = Math.abs(position - lastPositionRef.current) <= SMOOTH_STEP_LIMIT_SECONDS;
  lastPositionRef.current = position;
  const gliding = status === "playing" && !recovering && scrub === null && steppedOn;

  const commit = () => {
    if (scrub === null) return;
    onSeek(scrub);
    setScrub(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!seekable || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const step = event.shiftKey ? SEEK_STEP_LARGE_SECONDS : SEEK_STEP_SECONDS;
    const target = position + (event.key === "ArrowRight" ? step : -step);
    setScrub(null);
    onSeek(Math.min(Math.max(target, 0), duration));
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Elapsed time where the bar starts, total where it ends. */}
      <div className="flex items-center gap-2">
        <span className="time" data-slot="current-time" data-idle={!active}>
          {formatTime(active ? position : 0)}
        </span>
        <Slider
          value={seekable ? position : 0}
          max={seekable ? duration : 0}
          disabled={!seekable}
          formatTip={formatTime}
          state={recovering ? "recovering" : status === "loading" ? "loading" : undefined}
          smooth={gliding}
          onScrub={setScrub}
          onCommit={onSeek}
          inputProps={{
            step: 1,
            value: seekable ? position : 0,
            "aria-label": strings.controls.progress,
            "aria-valuetext": seekable ? formatTime(position) : undefined,
            onChange: (event) => setScrub(Number(event.target.value)),
            onKeyDown: handleKeyDown,
            onKeyUp: commit,
            onBlur: commit,
          }}
        />
        <span className="time" data-end="true" data-idle={!seekable}>
          {formatTime(seekable ? duration : NaN)}
        </span>
      </div>

      {/* Three columns keep the transport dead centre whatever sits at the sides. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <span />
        <div className="flex items-center gap-1">
          <button type="button" onClick={onPrevious} disabled={!canPrevious} aria-label={strings.controls.previous} className="icon-button">
            <PreviousIcon />
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={!active}
            aria-label={status === "playing" ? strings.controls.pause : strings.controls.play}
            data-busy={waiting}
            className="icon-button play-button"
          >
            <span className="busy-swap" data-busy={waiting}>
              <PlayPauseIcon playing={status === "playing"} size={20} />
              <SpinnerIcon size={20} />
            </span>
          </button>
          <button type="button" onClick={onNext} disabled={!canNext} aria-label={strings.controls.next} className="icon-button">
            <NextIcon />
          </button>
        </div>
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={onCycleRepeat} aria-label={strings.controls.repeat[repeat]} className="icon-button">
            <RepeatIcon />
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}
