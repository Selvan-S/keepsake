import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createSerialQueue } from "./serial-queue.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("tasks run one at a time, in submission order", async () => {
  // The property that matters: overlapping page requests to Instagram are the
  // traffic shape worth not producing.
  const queue = createSerialQueue();
  const order: string[] = [];
  let running = 0;
  let maxConcurrent = 0;

  const task = (name: string) => async () => {
    running += 1;
    maxConcurrent = Math.max(maxConcurrent, running);
    await tick();
    order.push(name);
    running -= 1;
    return name;
  };

  const results = await Promise.all([
    queue.run(task("a")),
    queue.run(task("b")),
    queue.run(task("c")),
  ]);

  assert.equal(maxConcurrent, 1, "never more than one task in flight");
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.deepEqual(results, ["a", "b", "c"]);
});

test("a failing task rejects its own caller and nothing else", async () => {
  const queue = createSerialQueue();
  const boom = queue.run(async () => {
    throw new Error("boom");
  });
  const after = queue.run(async () => "still ran");

  await assert.rejects(boom, /boom/);
  // A wedged queue would leave every later page request hanging forever.
  assert.equal(await after, "still ran");
});

test("pending reports whether anything is queued", async () => {
  const queue = createSerialQueue();
  assert.equal(queue.pending, false);
  const task = queue.run(async () => {
    await tick();
  });
  assert.equal(queue.pending, true);
  await task;
  assert.equal(queue.pending, false);
});

test("work queued from inside a task still serialises", async () => {
  const queue = createSerialQueue();
  const order: number[] = [];
  const first = queue.run(async () => {
    order.push(1);
    await tick();
  });
  const second = queue.run(async () => {
    order.push(2);
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2]);
});
