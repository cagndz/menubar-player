import { useEffect, useRef, useState } from "react";
import { EASE_OUT, useReducedMotion } from "../lib/motion";

/** Speed of the scroll, constant whatever the length. */
const PIXELS_PER_SECOND = 40;
/** Before it starts: passing over a row on the way somewhere moves nothing. */
const START_DELAY_MS = 500;
/** Held at the end, and at the start again before each new pass. */
const HOLD_MS = 1000;
/** Each half of the fade that takes it back to the start. */
const FADE_MS = 150;
/** Going back to the start once the hover or the focus ends. */
const RETURN_MS = 200;

const easeOut = `cubic-bezier(${EASE_OUT.join(", ")})`;

interface MarqueeTextProps {
  text: string;
  className?: string;
}

/**
 * A title that ends in an ellipsis when it doesn't fit, and scrolls through
 * the rest while the pointer or the keyboard focus rests on what holds it
 * (the nearest `[data-marquee-host]`). Only if it doesn't fit, and never with
 * Reduce Motion. The full title is always the tooltip and what assistive
 * technology reads.
 */
export function MarqueeText({ text, className = "" }: MarqueeTextProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [running, setRunning] = useState(false);
  const reducedMotion = useReducedMotion();

  // How far the text runs past the box; recomputed when either changes size.
  useEffect(() => {
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const measure = () => setOverflow(Math.max(0, Math.ceil(inner.scrollWidth - box.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);

  // Hover or focus on the host, and nothing while the popover is hidden.
  useEffect(() => {
    const host = boxRef.current?.closest<HTMLElement>("[data-marquee-host]");
    if (!host) return;
    const engage = () => setEngaged(true);
    const release = () => setEngaged(host.matches(":hover") || host.contains(document.activeElement));
    const releaseOnFocusOut = (event: FocusEvent) => {
      if (!host.contains(event.relatedTarget as Node | null) && !host.matches(":hover")) setEngaged(false);
    };
    const stop = () => setEngaged(false);
    host.addEventListener("pointerenter", engage);
    host.addEventListener("pointerleave", release);
    host.addEventListener("focusin", engage);
    host.addEventListener("focusout", releaseOnFocusOut);
    window.addEventListener("blur", stop);
    return () => {
      host.removeEventListener("pointerenter", engage);
      host.removeEventListener("pointerleave", release);
      host.removeEventListener("focusin", engage);
      host.removeEventListener("focusout", releaseOnFocusOut);
      window.removeEventListener("blur", stop);
    };
  }, []);

  const active = engaged && overflow > 0 && !reducedMotion;

  useEffect(() => {
    const inner = textRef.current;
    if (!active || !inner || typeof inner.animate !== "function") return;

    let cancelled = false;
    let timer: number | undefined;
    let current: Animation | null = null;
    const wait = (ms: number) => new Promise<void>((resolve) => (timer = window.setTimeout(resolve, ms)));
    // Each leg holds its last frame until the next one takes over from it.
    const play = (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const previous = current;
      current = inner.animate(keyframes, { fill: "forwards", ...options });
      previous?.cancel();
      return current.finished.then(
        () => undefined,
        () => undefined,
      );
    };
    const end = `translateX(${-overflow}px)`;

    void (async () => {
      await wait(START_DELAY_MS);
      while (!cancelled) {
        setRunning(true);
        await play([{ transform: "translateX(0)" }, { transform: end }], {
          duration: (overflow / PIXELS_PER_SECOND) * 1000,
          easing: "linear",
        });
        if (cancelled) return;
        await wait(HOLD_MS);
        if (cancelled) return;
        // Back to the start out of sight: fade out, jump, fade in.
        await play(
          [
            { transform: end, opacity: 1 },
            { transform: end, opacity: 0 },
          ],
          { duration: FADE_MS, easing: easeOut },
        );
        if (cancelled) return;
        await play(
          [
            { transform: "translateX(0)", opacity: 0 },
            { transform: "translateX(0)", opacity: 1 },
          ],
          {
            duration: FADE_MS,
            easing: easeOut,
          },
        );
        if (cancelled) return;
        await wait(HOLD_MS);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const from = current ? getComputedStyle(inner).transform : "none";
      for (const animation of inner.getAnimations()) animation.cancel();
      if (from === "none" || !document.hasFocus()) {
        setRunning(false);
        return;
      }
      // Hover or focus over: glide back to the start, then the ellipsis returns.
      const back = inner.animate([{ transform: from }, { transform: "translateX(0)" }], { duration: RETURN_MS, easing: easeOut });
      void back.finished.then(
        () => setRunning(false),
        () => setRunning(false),
      );
    };
  }, [active, overflow]);

  return (
    <span ref={boxRef} className={`marquee ${className}`} data-running={running} title={text}>
      <span ref={textRef} className="marquee-text">
        {text}
      </span>
    </span>
  );
}
