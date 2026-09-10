import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isAllowedMediaHost, proxiedMediaUrl } from "./media-url.ts";

test("real Instagram CDN hosts are allowed", () => {
  for (const host of [
    "cdninstagram.com",
    "scontent.cdninstagram.com",
    "instagram.fcjb1-2.fna.fbcdn.net",
    "fbcdn.net",
  ]) {
    assert.equal(isAllowedMediaHost(host), true, host);
  }
});

test("host matching is case-insensitive", () => {
  assert.equal(isAllowedMediaHost("SCONTENT.CDNINSTAGRAM.COM"), true);
});

test("lookalike hosts are rejected", () => {
  // The suffix check must not be satisfied by a domain that merely ends in the
  // same letters — the boundary dot is what makes these distinct.
  for (const host of [
    "evilcdninstagram.com",
    "cdninstagram.com.evil.test",
    "fbcdn.net.evil.test",
    "notfbcdn.net",
    "example.com",
    "localhost",
    "127.0.0.1",
  ]) {
    assert.equal(isAllowedMediaHost(host), false, host);
  }
});

test("proxiedMediaUrl encodes the target so query strings survive", () => {
  const src = "https://scontent.cdninstagram.com/v/t51.jpg?a=1&b=2";
  const proxied = proxiedMediaUrl(src);
  const parsed = new URL(proxied, "https://local.test");
  assert.equal(parsed.pathname, "/api/media");
  assert.equal(parsed.searchParams.get("u"), src);
  assert.equal(parsed.searchParams.get("name"), null);
});

test("proxiedMediaUrl carries a download name when given one", () => {
  const parsed = new URL(proxiedMediaUrl("https://fbcdn.net/x.mp4", "nasa_reel.mp4"), "https://local.test");
  assert.equal(parsed.searchParams.get("name"), "nasa_reel.mp4");
});
