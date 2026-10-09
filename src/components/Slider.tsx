import { useRef, useState, type InputHTMLAttributes, type PointerEvent } from "react";

interface SliderProps {
  value: number;
  max: number;
  disabled?: boolean;
  /** Vertical sliders fill from the bottom. */
  orientation?: "horizontal" | "vertical";
  /** Label for the value under the pointer; no floating label when absent. */
  formatTip?: (value: number) => string;
  /** How the value is being obtained right now, for the progress bar's waiting looks. */
  state?: "loading" | "recovering";
  /** Called while dragging, with null when the drag ends. */
  onScrub?: (value: number | null) => void;
  /** Called with the value chosen: when the pointer is released, or on every move with `live`. */
  onCommit: (value: number) => void;
  /** Commit on every move of a drag instead of at its end. */
  live?: boolean;
  /** Glide to each new value over a second, for a value that ticks along on its own. */
  smooth?: boolean;
  /** Preview only: draw a state without the real input. */
  force?: string;
  /** For the range input that carries the keyboard and the accessible name. */
  inputProps: InputHTMLAttributes<HTMLInputElement>;
}

/**
 * A slider drawn as a line with a thumb that shows when it can be grabbed.
 * The pointer is tracked on the slider itself, so the value under it is
 * exact to the pixel; an invisible range input on top keeps the keyboard and
 * assistive technology working.
 */
export function Slider(props: SliderProps) {
  const { value, max, disabled = false, orientation = "horizontal", formatTip, state, onScrub, onCommit, live, smooth = false, force, inputProps } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  // The value under the pointer, kept after it leaves so the label can fade out in place.
  const [hover, setHover] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);

  const vertical = orientation === "vertical";
  const usable = !disabled && max > 0;
  const ratio = usable ? Math.min(Math.max(value / max, 0), 1) : 0;

  const valueAt = (event: PointerEvent) => {
    const rect = rootRef.current!.getBoundingClientRect();
    const at = vertical
      ? rect.height > 0
        ? (rect.bottom - event.clientY) / rect.height
        : 0
      : rect.width > 0
        ? (event.clientX - rect.left) / rect.width
        : 0;
    return Math.min(Math.max(at, 0), 1) * max;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!usable || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const next = valueAt(event);
    setDragging(true);
    setHover(next);
    setHovering(true);
    onScrub?.(next);
    if (live) onCommit(next);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!usable) return;
    const next = valueAt(event);
    setHover(next);
    setHovering(true);
    if (!dragging) return;
    onScrub?.(next);
    if (live) onCommit(next);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!dragging) return;
    setDragging(false);
    onScrub?.(null);
    if (commit && !live) onCommit(valueAt(event));
  };

  const tipShown = hovering && usable;
  const fill = vertical ? `scaleY(${ratio})` : `scaleX(${ratio})`;
  const travel = vertical ? `translateY(${-ratio * 100}%)` : `translateX(${ratio * 100}%)`;

  return (
    <div
      ref={rootRef}
      className="slider"
      data-orientation={orientation}
      data-state={state}
      data-disabled={!usable}
      data-dragging={dragging}
      data-smooth={smooth && !dragging}
      data-force={force}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      onPointerLeave={() => {
        if (!dragging) setHovering(false);
      }}
    >
      <div className="slider-track" />
      <div className="slider-fill" style={{ transform: fill }} />
      <div className="slider-rail" style={{ transform: travel }}>
        <i className="slider-thumb" />
      </div>
      {formatTip && usable && (
        <div className="slider-tip-rail" style={{ transform: `translateX(${(hover / max) * 100}%)` }} aria-hidden="true">
          <output className="slider-tip" data-shown={tipShown}>
            {formatTip(hover)}
          </output>
        </div>
      )}
      <input
        type="range"
        min={0}
        max={usable ? max : 0}
        disabled={!usable}
        aria-orientation={vertical ? "vertical" : undefined}
        {...inputProps}
      />
    </div>
  );
}
