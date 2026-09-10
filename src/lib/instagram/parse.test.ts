import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extractShortcodeFromPath, extractUsernameFromPath, parseQuery, shortcodeFromRedirectTarget } from "./parse.ts";

test("bare usernames and @handles resolve to a profile", () => {
  for (const input of ["nasa", "@nasa", "  nasa  ", "NASA"]) {
    assert.deepEqual(parseQuery(input).items, [{ kind: "profile", username: "nasa" }], input);
  }
});

test("usernames keep dots and underscores but reject other punctuation", () => {
  assert.deepEqual(parseQuery("some.user_1").items, [{ kind: "profile", username: "some.user_1" }]);
  assert.equal(parseQuery("bad!name").items.length, 0);
  // A consecutive-dot handle is not registrable on Instagram.
  assert.equal(parseQuery("a..b").items.length, 0);
});

test("profile links resolve, with the tab carried through", () => {
  assert.deepEqual(parseQuery("https://www.instagram.com/nasa/").items, [{ kind: "profile", username: "nasa" }]);
  assert.deepEqual(parseQuery("https://instagram.com/nasa/reels/").items, [
    { kind: "profile", username: "nasa", tab: "reels" },
  ]);
  assert.deepEqual(parseQuery("https://instagram.com/nasa/highlights").items, [
    { kind: "profile", username: "nasa", tab: "highlights" },
  ]);
  assert.deepEqual(parseQuery("https://www.instagram.com/stories/nasa/").items, [
    { kind: "profile", username: "nasa", tab: "stories" },
  ]);
});

test("post, reel and tv links all yield the shortcode", () => {
  for (const path of ["p", "reel", "tv"]) {
    assert.deepEqual(
      parseQuery(`https://www.instagram.com/${path}/Dbn-XJhk0_-/`).items,
      [{ kind: "post", shortcode: "Dbn-XJhk0_-" }],
      path,
    );
  }
});

test("reserved path segments are never mistaken for usernames", () => {
  // Without the reserved list, /explore/ would resolve to a user named "explore".
  for (const seg of ["explore", "accounts", "direct", "about", "developer"]) {
    assert.equal(extractUsernameFromPath(`/${seg}/`), null, seg);
  }
});

test("non-Instagram hosts are rejected", () => {
  for (const url of [
    "https://example.com/nasa/",
    "https://instagram.com.evil.test/nasa/",
    "https://notinstagram.com/p/Dbn-XJhk0_-/",
  ]) {
    assert.equal(parseQuery(url).items.length, 0, url);
  }
});

test("l.instagram.com wrappers are unwrapped to the inner link", () => {
  const wrapped = `https://l.instagram.com/?u=${encodeURIComponent("https://www.instagram.com/p/Dbn-XJhk0_-/")}`;
  assert.deepEqual(parseQuery(wrapped).items, [{ kind: "post", shortcode: "Dbn-XJhk0_-" }]);
});

test("share links are passed through for server-side redirect resolution", () => {
  const [item] = parseQuery("https://www.instagram.com/share/abc123/").items;
  assert.equal(item?.kind, "share");
  // /share/ carries no shortcode, so it must not be parsed as a post.
  assert.equal(extractShortcodeFromPath("/share/p/Dbn-XJhk0_-/"), null);
});

test("several links in one paste are all parsed and deduplicated", () => {
  const paste = `look at these
    https://www.instagram.com/p/Dbn-XJhk0_-/
    https://www.instagram.com/p/Dbn-XJhk0_-/
    https://www.instagram.com/nasa/`;
  assert.deepEqual(parseQuery(paste).items, [
    { kind: "post", shortcode: "Dbn-XJhk0_-" },
    { kind: "profile", username: "nasa" },
  ]);
});

test("trailing sentence punctuation is trimmed off a pasted link", () => {
  assert.deepEqual(parseQuery("see https://www.instagram.com/p/Dbn-XJhk0_-/.").items, [
    { kind: "post", shortcode: "Dbn-XJhk0_-" },
  ]);
});

test("a highlight share link reports a helpful error rather than nothing", () => {
  const result = parseQuery("https://www.instagram.com/s/aGlnaGxpZ2h0/");
  assert.equal(result.items.length, 0);
  assert.match(result.error ?? "", /highlight share link/i);
});

test("empty and unusable input carries the generic error", () => {
  assert.match(parseQuery("").error ?? "", /Paste a username/i);
  assert.match(parseQuery("   ").error ?? "", /Paste a username/i);
});

test("shortcodeFromRedirectTarget follows a ?next= login redirect", () => {
  const target = `https://www.instagram.com/accounts/login/?next=${encodeURIComponent("/p/Dbn-XJhk0_-/")}`;
  assert.equal(shortcodeFromRedirectTarget(target), "Dbn-XJhk0_-");
  assert.equal(shortcodeFromRedirectTarget("https://www.instagram.com/nasa/"), null);
});
