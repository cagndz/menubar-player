import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

/** The thumb is never shorter than this, however long the list. */
const MIN_THUMB = 24;
/** Quiet time before the thumb fades out. */
const IDLE_MS = 800;

/**
 * A scrolling area with a thin thumb drawn over its content instead of the
 * system's scrollbar, which takes 15 px of width whenever a mouse is
 * connected. The thumb shows only when there is something to scroll, while
 * scrolling or with the pointer over the area, and can be dragged. It is
 * hidden from assistive technology: the keyboard and the wheel scroll the
 * area itself.
 */
export function ScrollArea({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<number | undefined>(undefined);
  const dragRef = useRef<{ startY: number; startScroll: number; ratio: number } | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Size and place the thumb from the viewport's own numbers, straight on the element.
  const layout = useCallback(() => {
    const viewport = viewportRef.current;
    const thumb = thumbRef.current;
    if (!viewport || !thumb) return;
    const { clientHeight, scrollHeight, scrollTop } = viewport;
    const overflow = scrollHeight - clientHeight > 1;
    setOverflowing(overflow);
    if (!overflow) return;
    const height = Math.max((clientHeight * clientHeight) / scrollHeight, MIN_THUMB);
    const travel = clientHeight - height;
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translateY(${(scrollTop / (scrollHeight - clientHeight)) * travel}px)`;
  }, []);

  const wake = useCallback(() => {
    setActive(true);
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setActive(false), IDLE_MS);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    layout();
    // The list grows and shrinks, and the popover can change height.
    const observer = new ResizeObserver(layout);
    observer.observe(viewport);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
      window.clearTimeout(idleTimerRef.current);
    };
  }, [layout]);

  const onThumbDown = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const thumb = thumbRef.current;
    if (!viewport || !thumb || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const travel = viewport.clientHeight - thumb.offsetHeight;
    dragRef.current = {
      startY: event.clientY,
      startScroll: viewport.scrollTop,
      ratio: travel > 0 ? (viewport.scrollHeight - viewport.clientHeight) / travel : 0,
    };
    setDragging(true);
  };
  const onThumbMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !viewportRef.current) return;
    viewportRef.current.scrollTop = drag.startScroll + (event.clientY - drag.startY) * drag.ratio;
  };
  const onThumbUp = () => {
    dragRef.current = null;
    setDragging(false);
    wake();
  };

  return (
    <div className="scroll-area" onPointerMove={wake} onPointerEnter={wake}>
      <div
        ref={viewportRef}
        className="scroll-viewport"
        onScroll={() => {
          layout();
          wake();
        }}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      <div
        ref={thumbRef}
        className="scroll-thumb"
        data-overflow={overflowing}
        data-shown={active || dragging}
        data-dragging={dragging}
        aria-hidden="true"
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>
  );
}
