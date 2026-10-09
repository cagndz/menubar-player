// Pressing "next" or "previous" several times in a row must not resolve every
// track skipped over. A resolution asked for by navigation waits for a short
// pause in the presses, and never starts while another one is still running.

const NAVIGATION_SETTLE_MS = 300;

/** Thrown inside a queued resolution when a newer press has replaced it. */
export const SUPERSEDED = Symbol("superseded");

interface QueueOptions {
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createNavigationQueue({ settleMs = NAVIGATION_SETTLE_MS, sleep }: QueueOptions = {}) {
  const wait = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Settles when the resolution currently running, if any, is over.
  let running: Promise<void> = Promise.resolve();

  return {
    /**
     * Runs `resolve` for the latest press only: after the settle time, and
     * after any resolution already running has finished. `isCurrent` says
     * whether this press is still the last one; if it isn't by then, the
     * promise rejects with `SUPERSEDED` and `resolve` is never called.
     */
    async run<T>(isCurrent: () => boolean, resolve: () => Promise<T>): Promise<T> {
      await wait(settleMs);
      if (!isCurrent()) throw SUPERSEDED;

      await running;
      if (!isCurrent()) throw SUPERSEDED;

      const task = resolve();
      running = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };
}
