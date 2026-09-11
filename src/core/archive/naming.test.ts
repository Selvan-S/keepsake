import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { PostResult } from "../instagram/types.ts";
import { archivePath, entriesFromPosts, extFor, fileName, plural, safeSegment } from "./naming.ts";

function post(overrides: Partial<PostResult> = {}): PostResult {
  return {
    shortcode: "ABC123",
    url: "https://www.instagram.com/p/ABC123/",
    kind: "image",
    takenAt: 1_700_000_000,
    caption: "",
    likeCount: 0,
    commentCount: 0,
    owner: { username: "nasa", fullName: "NASA", profilePicUrl: null },
    items: [
      { id: "1", kind: "image", url: "https://cdn.test/a.jpg", thumbnailUrl: "t", width: 1, height: 1 },
    ],
    complete: true,
    ...overrides,
  };
}

test("the extension follows the media kind, then the url", () => {
  assert.equal(extFor("video", "https://cdn.test/a.jpg"), "mp4", "a video is mp4 regardless of url");
  assert.equal(extFor("image", "https://cdn.test/a.png?x=1"), "png");
  assert.equal(extFor("image", "https://cdn.test/a.WEBP"), "webp");
  assert.equal(extFor("image", "https://cdn.test/a"), "jpg", "jpg is the fallback");
});

test("safeSegment survives arbitrary user text", () => {
  // Highlight titles are free text: emoji, slashes and quotes all occur.
  assert.equal(safeSegment("Trip to Mars!"), "Trip_to_Mars");
  assert.equal(safeSegment("a/b\\c"), "a_b_c");
  assert.equal(safeSegment("  ✨  "), "item", "a title with nothing usable still yields a name");
  assert.equal(safeSegment(""), "item");
  assert.equal(safeSegment("x".repeat(80)).length, 48, "capped so paths stay portable");
  assert.equal(safeSegment("...leading"), "...leading".replace(/^_+|_+$/g, ""));
});

test("file names lead with the date so a folder sorts chronologically", () => {
  const name = fileName(post(), 0, "image", "https://cdn.test/a.jpg");
  assert.equal(name, "nasa_2023-11-14_ABC123.jpg");
});

test("an undated post is still named, not skipped", () => {
  assert.equal(
    fileName(post({ takenAt: null }), 0, "image", "https://cdn.test/a.jpg"),
    "nasa_undated_ABC123.jpg",
  );
});

test("multi-item posts get a zero-padded slide suffix", () => {
  const carousel = post({
    items: [
      { id: "1", kind: "image", url: "a.jpg", thumbnailUrl: "t", width: 1, height: 1 },
      { id: "2", kind: "video", url: "b.mp4", thumbnailUrl: "t", width: 1, height: 1 },
    ],
  });
  assert.equal(fileName(carousel, 0, "image", "a.jpg"), "nasa_2023-11-14_ABC123_01.jpg");
  assert.equal(fileName(carousel, 1, "video", "b.mp4"), "nasa_2023-11-14_ABC123_02.mp4");
  // Single-item posts get no suffix at all.
  assert.equal(fileName(post(), 0, "image", "a.jpg"), "nasa_2023-11-14_ABC123.jpg");
});

test("a missing owner still produces a usable name", () => {
  const orphan = post({ owner: { username: "", fullName: "", profilePicUrl: null } });
  assert.equal(fileName(orphan, 0, "image", "a.jpg"), "ig_2023-11-14_ABC123.jpg");
});

test("highlights are filed per album, everything else per tab", () => {
  const highlight = post({ highlightTitle: "Trip to Mars!" });
  assert.equal(
    archivePath("nasa", "highlights", highlight, 0, "image", "a.jpg"),
    "nasa/highlights/Trip_to_Mars/nasa_Trip_to_Mars_2023-11-14_ABC123.jpg",
  );
  assert.equal(
    archivePath("nasa", "posts", post(), 0, "image", "a.jpg"),
    "nasa/posts/nasa_2023-11-14_ABC123.jpg",
  );
  // A highlight with no title falls back to the flat tab folder.
  assert.equal(
    archivePath("nasa", "highlights", post(), 0, "image", "a.jpg"),
    "nasa/highlights/nasa_2023-11-14_ABC123.jpg",
  );
});

test("entriesFromPosts flattens every item of every post", () => {
  const entries = entriesFromPosts("nasa", "posts", [
    post(),
    post({
      shortcode: "DEF456",
      items: [
        { id: "1", kind: "image", url: "x.jpg", thumbnailUrl: "t", width: 1, height: 1 },
        { id: "2", kind: "video", url: "y.mp4", thumbnailUrl: "t", width: 1, height: 1 },
      ],
    }),
  ]);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.url),
    ["https://cdn.test/a.jpg", "x.jpg", "y.mp4"],
  );
});

test("plural only pluralises when it should", () => {
  assert.equal(plural(1, "file"), "1 file");
  assert.equal(plural(0, "file"), "0 files");
  assert.equal(plural(2, "file"), "2 files");
});
