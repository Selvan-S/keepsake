import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { PostResult, ProfileFeed, ProfileResult } from "../instagram/types.ts";
import { BatchAccumulator, DEFAULT_BUDGET, estimateBatchCount, formatBytes } from "./batch.ts";
import { avatarEntry, orderedTabs, planEntries, postsStillNeeded } from "./plan.ts";

function post(shortcode: string, itemCount = 1, extra: Partial<PostResult> = {}): PostResult {
  return {
    shortcode,
    url: `https://www.instagram.com/p/${shortcode}/`,
    kind: "image",
    takenAt: 1_700_000_000,
    caption: "",
    likeCount: 0,
    commentCount: 0,
    owner: { username: "probe", fullName: "", profilePicUrl: null },
    items: Array.from({ length: itemCount }, (_, i) => ({
      id: `${shortcode}-${i}`,
      kind: "image" as const,
      url: `https://cdn.test/${shortcode}-${i}.jpg`,
      thumbnailUrl: "t",
      width: 1,
      height: 1,
    })),
    complete: true,
    ...extra,
  };
}

function feed(posts: PostResult[], hasMore = false): ProfileFeed {
  return { items: posts, cursor: hasMore ? "C" : null, hasMore, loaded: true };
}

function profile(overrides: Partial<ProfileResult> = {}): ProfileResult {
  return {
    username: "probe",
    fullName: "",
    biography: "",
    profilePicUrl: "https://cdn.test/avatar.jpg",
    followers: 0,
    following: 0,
    postCount: 0,
    isPrivate: false,
    isVerified: false,
    userId: "42",
    hasPublicStory: false,
    posts: feed([]),
    reels: feed([]),
    stories: feed([]),
    highlights: feed([]),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* plan                                                                        */
/* -------------------------------------------------------------------------- */

test("the most perishable tabs are archived first", () => {
  // If a long run is interrupted, what survives should be the part that cannot
  // be fetched again tomorrow.
  assert.deepEqual(orderedTabs(["reels", "posts", "highlights", "stories"]), [
    "stories",
    "highlights",
    "posts",
    "reels",
  ]);
  // Order is fixed, not the caller's order.
  assert.deepEqual(orderedTabs(["reels", "stories"]), ["stories", "reels"]);
  assert.deepEqual(orderedTabs([]), []);
});

test("only the requested tabs are planned", () => {
  const p = profile({ posts: feed([post("P1")]), reels: feed([post("R1")]) });
  const entries = planEntries(p, { tabs: ["posts"], perTabLimit: null });
  assert.deepEqual(
    entries.map((e) => e.shortcode),
    ["P1"],
  );
});

test("a carousel contributes one entry per slide", () => {
  // The user thinks in posts; the archive is measured in files. A three-slide
  // post is three fetches, which is why estimates are shown in files.
  const p = profile({ posts: feed([post("P1", 3)]) });
  const entries = planEntries(p, { tabs: ["posts"], perTabLimit: null });
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.name),
    [
      "probe/posts/probe_2023-11-14_P1_01.jpg",
      "probe/posts/probe_2023-11-14_P1_02.jpg",
      "probe/posts/probe_2023-11-14_P1_03.jpg",
    ],
  );
});

test("perTabLimit counts posts, not files", () => {
  const p = profile({ posts: feed([post("P1", 3), post("P2", 3), post("P3", 3)]) });
  const entries = planEntries(p, { tabs: ["posts"], perTabLimit: 2 });
  assert.deepEqual([...new Set(entries.map((e) => e.shortcode))], ["P1", "P2"]);
  assert.equal(entries.length, 6, "two posts of three slides each");
});

test("a limit applies per tab rather than across the archive", () => {
  const p = profile({
    posts: feed([post("P1"), post("P2"), post("P3")]),
    reels: feed([post("R1"), post("R2"), post("R3")]),
  });
  const entries = planEntries(p, { tabs: ["posts", "reels"], perTabLimit: 2 });
  assert.equal(entries.filter((e) => e.tab === "posts").length, 2);
  assert.equal(entries.filter((e) => e.tab === "reels").length, 2);
});

test("a resumed job skips what was already saved", () => {
  const p = profile({ posts: feed([post("P1"), post("P2"), post("P3")]) });
  const entries = planEntries(
    p,
    { tabs: ["posts"], perTabLimit: null },
    { alreadySaved: new Set(["P1", "P3"]) },
  );
  assert.deepEqual(
    entries.map((e) => e.shortcode),
    ["P2"],
  );
});

test("skipping happens before the limit, so a resume makes progress", () => {
  // If the limit were applied first, resuming a job with limit 2 would replan
  // the same two saved posts and archive nothing, forever.
  const p = profile({ posts: feed([post("P1"), post("P2"), post("P3"), post("P4")]) });
  const entries = planEntries(
    p,
    { tabs: ["posts"], perTabLimit: 2 },
    { alreadySaved: new Set(["P1", "P2"]) },
  );
  assert.deepEqual(
    entries.map((e) => e.shortcode),
    ["P3", "P4"],
  );
});

test("a selection archives exactly what was picked", () => {
  const p = profile({ posts: feed([post("P1"), post("P2"), post("P3")]) });
  const entries = planEntries(p, {
    tabs: ["posts"],
    perTabLimit: null,
    only: new Set(["P1", "P3"]),
  });
  assert.deepEqual(
    entries.map((e) => e.shortcode),
    ["P1", "P3"],
  );
});

test("highlights are filed per album", () => {
  const p = profile({
    highlights: feed([post("H1", 1, { kind: "highlight", highlightTitle: "Trip to Mars!" })]),
  });
  const entries = planEntries(p, { tabs: ["highlights"], perTabLimit: null });
  assert.equal(entries[0]!.name, "probe/highlights/Trip_to_Mars/probe_Trip_to_Mars_2023-11-14_H1.jpg");
});

test("the avatar is its own entry and is optional", () => {
  assert.equal(avatarEntry(profile())!.name, "probe/avatar.jpg");
  assert.equal(avatarEntry(profile({ profilePicUrl: null })), null);
});

test("postsStillNeeded says when to stop paging", () => {
  assert.equal(postsStillNeeded(12, false, null), 0, "no more pages means done");
  assert.equal(postsStillNeeded(12, false, 100), 0);
  assert.equal(postsStillNeeded(12, true, null), null, "everything: page until exhausted");
  assert.equal(postsStillNeeded(12, true, 100), 88);
  assert.equal(postsStillNeeded(120, true, 100), 0, "limit already met");
});

/* -------------------------------------------------------------------------- */
/* batch                                                                       */
/* -------------------------------------------------------------------------- */

test("a batch closes on the file limit", () => {
  const acc = new BatchAccumulator({ maxFiles: 3, maxBytes: Infinity });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(acc.accepts(1), true);
    acc.add(1);
  }
  assert.equal(acc.accepts(1), false);
  assert.equal(acc.fileCount, 3);
});

test("a batch closes on the byte limit before the file limit", () => {
  // This is the case that matters: 100 reels would be memory the tab does not
  // have, long before 100 files is reached.
  const acc = new BatchAccumulator({ maxFiles: 100, maxBytes: 1000 });
  acc.add(600);
  assert.equal(acc.accepts(500), false, "would overflow");
  assert.equal(acc.accepts(300), true, "fits");
});

test("a single oversized file still gets archived, in a batch of its own", () => {
  // Refusing it would stall the run forever rather than producing one big zip.
  const acc = new BatchAccumulator({ maxFiles: 100, maxBytes: 1000 });
  assert.equal(acc.accepts(50_000), true, "an empty batch accepts anything");
  acc.add(50_000);
  assert.equal(acc.accepts(1), false, "and is full immediately afterwards");
});

test("isFull reports the limits, checked after adding", () => {
  // Sizes are only knowable after downloading, so the run adds a file and then
  // asks whether to close. A batch can overshoot maxBytes by one file; that is
  // inherent, and the budget has to leave room for it.
  const acc = new BatchAccumulator({ maxFiles: 3, maxBytes: 1000 });
  assert.equal(acc.isFull, false, "an empty batch is never full");
  acc.add(100);
  assert.equal(acc.isFull, false);
  acc.add(2000);
  assert.equal(acc.isFull, true, "overshot the byte budget on a single file");

  const byCount = new BatchAccumulator({ maxFiles: 2, maxBytes: Infinity });
  byCount.add(1);
  assert.equal(byCount.isFull, false);
  byCount.add(1);
  assert.equal(byCount.isFull, true);
});

test("reset makes the accumulator reusable for the next batch", () => {
  const acc = new BatchAccumulator({ maxFiles: 2, maxBytes: 100 });
  acc.add(90);
  acc.add(5);
  assert.equal(acc.accepts(1), false);
  acc.reset();
  assert.equal(acc.isEmpty, true);
  assert.equal(acc.fileCount, 0);
  assert.equal(acc.byteCount, 0);
  assert.equal(acc.accepts(1), true);
});

test("a missing content-length does not corrupt the byte count", () => {
  const acc = new BatchAccumulator(DEFAULT_BUDGET);
  acc.add(Number.NaN);
  acc.add(-5);
  assert.equal(acc.byteCount, 0);
  assert.equal(acc.fileCount, 2, "the files still count toward the file limit");
});

test("the pre-flight batch estimate is a lower bound", () => {
  assert.equal(estimateBatchCount(0), 0);
  assert.equal(estimateBatchCount(1), 1);
  assert.equal(estimateBatchCount(100), 1);
  assert.equal(estimateBatchCount(101), 2);
  assert.equal(estimateBatchCount(400), 4);
  assert.equal(estimateBatchCount(50, { maxFiles: 10, maxBytes: Infinity }), 5);
});

test("byte counts read as sizes a person recognises", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(200 * 1024 * 1024), "200 MB");
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), "3.0 GB");
});
