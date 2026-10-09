import { describe, expect, it, vi } from "vitest";
import { createNavigationQueue, SUPERSEDED } from "./navigationQueue";

/** A queue whose settle time is released by hand, one waiter at a time. */
function setup() {
  const sleepers: (() => void)[] = [];
  const queue = createNavigationQueue({ sleep: () => new Promise<void>((resolve) => sleepers.push(resolve)) });
  let latest = 0;
  /** Simulates a press: it becomes the latest one, and asks for `resolve` to run. */
  const press = (resolve: () => Promise<string>) => {
    const mine = ++latest;
    const outcome = queue.run(() => mine === latest, resolve).then(
      (value) => value,
      (error) => error,
    );
    return outcome;
  };
  const settle = async () => {
    for (const wake of sleepers.splice(0)) wake();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { press, settle };
}

function controlled() {
  let finish!: (value: string) => void;
  const resolve = vi.fn(() => new Promise<string>((done) => (finish = done)));
  return { resolve, finish: (value: string) => finish(value) };
}

describe("createNavigationQueue", () => {
  it("doesn't resolve before the presses pause", async () => {
    const { press, settle } = setup();
    const only = controlled();

    const outcome = press(only.resolve);
    expect(only.resolve).not.toHaveBeenCalled();

    await settle();
    expect(only.resolve).toHaveBeenCalledOnce();
    only.finish("stream");
    expect(await outcome).toBe("stream");
  });

  it("resolves only the last of several presses in a row", async () => {
    const { press, settle } = setup();
    const resolvers = [controlled(), controlled(), controlled(), controlled()];

    const outcomes = resolvers.map((resolver) => press(resolver.resolve));
    await settle();

    expect(resolvers.map((resolver) => resolver.resolve.mock.calls.length)).toEqual([0, 0, 0, 1]);
    resolvers[3].finish("last");
    expect(await Promise.all(outcomes)).toEqual([SUPERSEDED, SUPERSEDED, SUPERSEDED, "last"]);
  });

  it("never has two resolutions running: a later press waits for the one in flight", async () => {
    const { press, settle } = setup();
    const first = controlled();
    const second = controlled();

    const firstOutcome = press(first.resolve);
    await settle();
    expect(first.resolve).toHaveBeenCalledOnce();

    const secondOutcome = press(second.resolve);
    await settle();
    // Its settle time has passed, but the first resolution is still running.
    expect(second.resolve).not.toHaveBeenCalled();

    first.finish("stale");
    await settle();
    expect(second.resolve).toHaveBeenCalledOnce();
    second.finish("current");
    expect(await secondOutcome).toBe("current");
    // The first one completed; whoever asked for it decides to ignore it.
    expect(await firstOutcome).toBe("stale");
  });

  it("drops presses made while one resolution runs, except the last", async () => {
    const { press, settle } = setup();
    const running = controlled();
    const skipped = controlled();
    const last = controlled();

    void press(running.resolve);
    await settle();
    const skippedOutcome = press(skipped.resolve);
    const lastOutcome = press(last.resolve);
    await settle();

    running.finish("stale");
    await settle();
    expect(skipped.resolve).not.toHaveBeenCalled();
    expect(last.resolve).toHaveBeenCalledOnce();
    last.finish("current");
    expect(await skippedOutcome).toBe(SUPERSEDED);
    expect(await lastOutcome).toBe("current");
  });

  it("keeps working after a resolution fails", async () => {
    const { press, settle } = setup();

    const failed = press(() => Promise.reject(new Error("boom")));
    await settle();
    expect(await failed).toBeInstanceOf(Error);

    const next = controlled();
    const outcome = press(next.resolve);
    await settle();
    next.finish("stream");
    expect(await outcome).toBe("stream");
  });
});
