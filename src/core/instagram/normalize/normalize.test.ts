import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mediaFromNode, pickBest, upgradeImageUrl } from "./media.ts";
import { kindFromItem, mapPost } from "./post.ts";
import { reelsFromJson, timelineFromJson } from "./feed.ts";
import { postsFromReels, reelsMediaFromJson } from "./highlights.ts";
import { profileFromUser } from "./profile.ts";

test("pickBest takes the largest rendition, and survives unsized entries", () => {
  assert.deepEqual(
    pickBest([
      { url: "small", width: 150, height: 150 },
      { url: "big", width: 1080, height: 1080 },
      { url: "mid", width: 640, height: 640 },
    ]),
    { url: "big", width: 1080, height: 1080 },
  );
  // An entry with no dimensions still beats having nothing at all.
  assert.deepEqual(pickBest([{ url: "only" }]), { url: "only", width: 0, height: 0 });
  assert.equal(pickBest([]), null);
  assert.equal(pickBest([{ width: 10, height: 10 }]), null, "no url means unusable");
  assert.equal(pickBest("not an array"), null);
});

test("upgradeImageUrl drops the thumbnail size segment", () => {
  assert.equal(upgradeImageUrl("https://cdn.test/a_s150x150.jpg"), "https://cdn.test/a.jpg");
  assert.equal(upgradeImageUrl("https://cdn.test/a.jpg"), "https://cdn.test/a.jpg");
});

test("a video node yields the video, with the image as its thumbnail", () => {
  const items = mediaFromNode(
    {
      video_versions: [{ url: "https://cdn.test/v.mp4", width: 720, height: 1280 }],
      image_versions2: { candidates: [{ url: "https://cdn.test/p_s150x150.jpg", width: 150, height: 150 }] },
    },
    "id1",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind, "video");
  assert.equal(items[0]!.url, "https://cdn.test/v.mp4");
  assert.equal(items[0]!.thumbnailUrl, "https://cdn.test/p.jpg", "thumbnail is upgraded too");
});

test("a node with no media yields nothing rather than a broken item", () => {
  assert.deepEqual(mediaFromNode({}, "id1"), []);
});

test("product_type wins over media_type when classifying a post", () => {
  // A reel is media_type 2 as well, so ordering here is what keeps reels from
  // being filed as plain videos.
  assert.equal(kindFromItem({ product_type: "clips", media_type: 2 }), "reel");
  assert.equal(kindFromItem({ product_type: "story_highlight" }), "highlight");
  assert.equal(kindFromItem({ product_type: "story" }), "story");
  assert.equal(kindFromItem({ media_type: 8 }), "carousel");
  assert.equal(kindFromItem({ media_type: 2 }), "video");
  assert.equal(kindFromItem({}), "image");
});

test("a carousel maps every slide, skipping ones with no media", () => {
  const post = mapPost({
    code: "CAR1",
    media_type: 8,
    user: { username: "probe" },
    carousel_media: [
      { image_versions2: { candidates: [{ url: "https://cdn.test/1.jpg", width: 10, height: 10 }] } },
      {},
      { video_versions: [{ url: "https://cdn.test/2.mp4", width: 10, height: 10 }] },
    ],
  });
  assert.equal(post.kind, "carousel");
  assert.equal(post.items.length, 2);
  assert.equal(post.complete, true);
  assert.equal(post.url, "https://www.instagram.com/p/CAR1/");
});

test("post urls use the path Instagram actually serves for that kind", () => {
  const at = (item: Record<string, unknown>) =>
    mapPost({ code: "X", ...item, image_versions2: { candidates: [{ url: "u", width: 1, height: 1 }] } }).url;
  assert.equal(at({ product_type: "clips" }), "https://www.instagram.com/reel/X/");
  assert.equal(at({ product_type: "story" }), "https://www.instagram.com/stories/X/");
  assert.equal(at({}), "https://www.instagram.com/p/X/");
});

test("timelineFromJson separates a missing profile from a broken response", () => {
  assert.throws(
    () => timelineFromJson({ errors: [{ description: "User lookup returned null" }] }, "probe"),
    /No public profile named @probe/,
  );
  assert.throws(
    () => timelineFromJson({ errors: [{ summary: "Bad Request" }] }, "probe"),
    /No public profile named @probe/,
  );
  assert.throws(
    () => timelineFromJson({ errors: [{ description: "server on fire" }] }, "probe"),
    /Could not load that profile/,
  );
  assert.throws(() => timelineFromJson({}, "probe"), /No public profile named @probe/);
});

test("timelineFromJson drops posts with no downloadable media", () => {
  const page = timelineFromJson(
    {
      data: {
        xdt_api__v1__feed__user_timeline_graphql_connection: {
          edges: [
            { node: { code: "HAS", image_versions2: { candidates: [{ url: "u", width: 1, height: 1 }] } } },
            { node: { code: "NONE" } },
          ],
          page_info: { end_cursor: "C", has_next_page: true },
        },
      },
    },
    "probe",
  );
  assert.deepEqual(
    page.items.map((p) => p.shortcode),
    ["HAS"],
  );
  assert.equal(page.cursor, "C");
  assert.equal(page.hasMore, true);
  assert.equal(page.loaded, true);
});

test("reelsFromJson reads both the wrapped and bare item shapes", () => {
  const feed = reelsFromJson({
    items: [
      { media: { code: "A", video_versions: [{ url: "a.mp4", width: 1, height: 1 }] } },
      { code: "B", video_versions: [{ url: "b.mp4", width: 1, height: 1 }] },
    ],
    paging_info: { max_id: "M", more_available: false },
  });
  assert.deepEqual(
    feed.items.map((p) => p.shortcode),
    ["A", "B"],
  );
  assert.equal(feed.cursor, "M");
  assert.equal(feed.hasMore, false);
});

test("reelsMediaFromJson handles the listed and keyed shapes", () => {
  assert.equal(reelsMediaFromJson({ reels_media: [{ id: "1" }, { id: "2" }] }).length, 2);
  assert.equal(reelsMediaFromJson({ reels: { a: { id: "1" }, b: { id: "2" } } }).length, 2);
  assert.deepEqual(reelsMediaFromJson(null), []);
});

test("a highlight's album title is pushed down onto each of its items", () => {
  const posts = postsFromReels(
    [
      {
        title: "Trips",
        items: [
          { code: "H1", image_versions2: { candidates: [{ url: "u", width: 1, height: 1 }] } },
          { code: "H2", image_versions2: { candidates: [{ url: "u", width: 1, height: 1 }] } },
        ],
      },
    ],
    "highlight",
  );
  assert.equal(posts.length, 2);
  for (const post of posts) {
    assert.equal(post.kind, "highlight");
    assert.equal(post.highlightTitle, "Trips");
  }
});

test("profileFromUser reads counts from both the mobile and web shapes", () => {
  const feeds = { items: [], cursor: null, hasMore: false, loaded: true };
  const mobile = profileFromUser(
    "probe",
    { username: "probe", follower_count: 10, following_count: 3, pk: "42" },
    feeds,
    feeds,
    feeds,
    feeds,
    false,
  );
  assert.equal(mobile.followers, 10);
  assert.equal(mobile.following, 3);
  assert.equal(mobile.userId, "42");

  const web = profileFromUser(
    "probe",
    { edge_followed_by: { count: 7 }, edge_follow: { count: 2 }, id: "99" },
    feeds,
    feeds,
    feeds,
    feeds,
    true,
  );
  assert.equal(web.followers, 7);
  assert.equal(web.following, 2);
  assert.equal(web.userId, "99");
  // The queried handle survives when the payload omits it.
  assert.equal(web.username, "probe");
  assert.equal(web.hasPublicStory, true);
});

test("profileFromUser tolerates a missing user node entirely", () => {
  const feeds = { items: [], cursor: null, hasMore: false, loaded: true };
  const profile = profileFromUser("probe", null, feeds, feeds, feeds, feeds, false);
  assert.equal(profile.username, "probe");
  assert.equal(profile.followers, 0);
  assert.equal(profile.userId, null);
  assert.equal(profile.profilePicUrl, null);
});
