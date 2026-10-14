import { useEffect, useRef, useState } from "react";
import { EASE_OUT, useReducedMotion } from "../lib/motion";

/** Speed of the scroll, constant whatever the length. */
const PIXELS_PER_SECOND = 40;
/** Before it starts: passing over a row on the way somewhere moves nothing. */
const START_DELAY_MS = 500;
/** Space between the title and the copy that follows it round. */
const GAP_PX = 32;
/** Going back to the start once the hover or the focus ends. */
const RETURN_MS = 200;

const easeOut = `cubic-bezier(${EASE_OUT.join(", ")})`;

interface MarqueeTextProps {
  text: string;
  className?: string;
}

/** The horizontal offset an element is drawn at right now, from its transform. */
function translateX(element: Element): number {
  const transform = getComputedStyle(element).transform;
  return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
}

/**
 * A title that ends in an ellipsis when it doesn't fit, and scrolls round
 * while the pointer or the keyboard focus rests on what holds it (the nearest
 * `[data-marquee-host]`): only if it doesn't fit, and never with Reduce Motion.
 *
 * The scroll is one continuous loop with no visible restart. While it runs, a
 * copy of the title follows it at a fixed gap; one pass moves everything by
 * the title's width plus that gap, which leaves the copy exactly where the
 * title started, so going back to the start is invisible. The copy is hidden
 * from assistive technology and exists only while the title moves.
 */
export function MarqueeText({ text, className = "" }: MarqueeTextProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const loopRef = useRef<Animation | null>(null);
  const [size, setSize] = useState({ text: 0, box: 0 });
  const [engaged, setEngaged] = useState(false);
  const [running, setRunning] = useState(false);
  const reducedMotion = useReducedMotion();

  // The title's own width and the box's, remeasured when either changes size.
  useEffect(() => {
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const measure = () => setSize({ text: Math.ceil(inner.scrollWidth), box: box.clientWidth });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);

  // Hover or focus on the host; the popover hiding ends both at once.
  useEffect(() => {
    const host = boxRef.current?.closest<HTMLElement>("[data-marquee-host]");
    if (!host) return;
    const engage = () => setEngaged(true);
    const release = () => setEngaged(host.contains(document.activeElement));
    const releaseOnFocusOut = (event: FocusEvent) => {
      if (!host.contains(event.relatedTarget as Node | null) && !host.matches(":hover")) setEngaged(false);
    };
    const hide = () => {
      setEngaged(false);
      for (const animation of trackRef.current?.getAnimations?.() ?? []) animation.cancel();
      loopRef.current = null;
      setRunning(false);
    };
    host.addEventListener("pointerenter", engage);
    host.addEventListener("pointerleave", release);
    host.addEventListener("focusin", engage);
    host.addEventListener("focusout", releaseOnFocusOut);
    window.addEventListener("blur", hide);
    return () => {
      host.removeEventListener("pointerenter", engage);
      host.removeEventListener("pointerleave", release);
      host.removeEventListener("focusin", engage);
      host.removeEventListener("focusout", releaseOnFocusOut);
      window.removeEventListener("blur", hide);
    };
  }, []);

  const overflows = size.text > size.box;
  const active = engaged && overflows && !reducedMotion;
  const distance = size.text + GAP_PX;

  // Engaged: half a second, then the copy comes in and the loop starts.
  // Released: glide to the nearest start, then back to a single title.
  useEffect(() => {
    const track = trackRef.current;
    if (!active || !track) return;
    const timer = window.setTimeout(() => setRunning(true), START_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      const loop = loopRef.current;
      if (!loop) return;
      const from = translateX(track);
      loop.cancel();
      loopRef.current = null;
      // Either start looks the same: 0, or one pass along, where the copy stands.
      const to = Math.abs(from) < distance / 2 ? 0 : -distance;
      const back = track.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
        duration: RETURN_MS,
        easing: easeOut,
        fill: "forwards",
      });
      const done = () => {
        back.cancel();
        setRunning(false);
      };
      void back.finished.then(done, done);
    };
  }, [active, distance]);

  useEffect(() => {
    const track = trackRef.current;
    if (!running || !track || typeof track.animate !== "function" || loopRef.current) return;
    // One pass moves the title and its gap along at a constant speed, with no
    // stop: the copy comes round into the title's place and carries straight on.
    loopRef.current = track.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-distance}px)` }], {
      duration: (distance / PIXELS_PER_SECOND) * 1000,
      easing: "linear",
      iterations: Infinity,
    });
  }, [running, distance]);

  // Nothing is left running once the title goes away.
  useEffect(() => {
    const track = trackRef.current;
    return () => {
      for (const animation of track?.getAnimations?.() ?? []) animation.cancel();
    };
  }, []);

  return (
    <span
      ref={boxRef}
      className={`marquee ${className}`}
      data-running={running}
      // With Reduce Motion it never scrolls, so the tooltip is the way to read it whole.
      title={reducedMotion && overflows ? text : undefined}
    >
      <span ref={trackRef} className="marquee-track">
        <span ref={textRef} className="marquee-text">
          {text}
        </span>
        {running && (
          <span className="marquee-text" aria-hidden="true" style={{ marginLeft: GAP_PX }}>
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
