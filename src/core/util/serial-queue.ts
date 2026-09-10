/**
 * A queue that runs tasks one at a time, in the order they were submitted.
 *
 * This replaces a boolean "lock" ref that callers polled with
 * `await sleep(200); continue;`. A busy-wait burns renders, makes ordering
 * arbitrary, and answers "is something already running?" with information that
 * is out of date the moment it is read. Here a caller just awaits its turn.
 *
 * Serialisation is the point, not an implementation detail: overlapping page
 * requests to Instagram are exactly the traffic shape worth not producing.
 */
export type SerialQueue = {
  /** Queue a task; resolves or rejects with that task's own result. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** True while anything is queued or running. */
  readonly pending: boolean;
};

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let depth = 0;

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      depth += 1;
      // Chained off both settle paths, so one task's failure does not wedge the
      // queue for everything behind it.
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result.finally(() => {
        depth -= 1;
      });
    },
    get pending() {
      return depth > 0;
    },
  };
}
