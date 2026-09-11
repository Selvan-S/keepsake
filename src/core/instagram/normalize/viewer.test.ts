import { strict as assert } from "node:assert";
import { test } from "node:test";
import { viewerFromHtml } from "./viewer.ts";

const ID = "99900011122";

/**
 * Shaped after what instagram.com actually served to a live session: the
 * viewer's profile object carries the account id, and the page is full of other
 * people's usernames that must not be mistaken for it.
 */
function pageWithViewer(username: string, distance = 200): string {
  const filler = "x".repeat(distance);
  return (
    `<!DOCTYPE html><html><script>{"suggested":[{"username":"someone_else","id":"999"}]}` +
    `{"external_url":"","fbid":"17800000000000000","full_name":"","id":"${ID}",` +
    `${filler}"username":"${username}","is_private":false}</script></html>`
  );
}

test("a decoy username just before the id does not win", () => {
  // The real page puts other accounts' usernames all around the viewer's own
  // object, and one of them is usually closer than ours.
  const html =
    `{"username":"someone_else","id":"999"},{"id":"${ID}","is_private":false,"username":"ours"}`;
  const check = viewerFromHtml(html, ID);
  assert.equal(check.username, "ours");
});

test("the viewer is read from beside their own account id", () => {
  const check = viewerFromHtml(pageWithViewer("throwaway_acct"), ID);
  assert.equal(check.loggedIn, true);
  assert.equal(check.username, "throwaway_acct");
});

test("another account's username sitting closer does not win", () => {
  // A homepage is full of usernames. The id is the anchor precisely because it
  // is the only thing that identifies which one is ours.
  const html =
    `{"username":"decoy_one","id":"111"}` +
    `{"id":"${ID}","username":"real_viewer"}` +
    `{"username":"decoy_two","id":"222"}`;
  const check = viewerFromHtml(html, ID);
  assert.equal(check.loggedIn, true);
  assert.equal(check.username, "real_viewer");
});

test("a logged-out page is reported as refused, not as unknown", () => {
  const html = '<!DOCTYPE html><html><form action="/accounts/login/" method="post"></form></html>';
  const check = viewerFromHtml(html, ID);
  assert.equal(check.loggedIn, false);
  assert.equal(check.sawLoginPage, true);
});

test("a page without the id is not logged in, and says nothing about why", () => {
  const check = viewerFromHtml('<html><script>{"username":"stranger","id":"999"}</script></html>', ID);
  assert.equal(check.loggedIn, false);
  assert.equal(check.sawLoginPage, false);
});

test("being signed in survives the username being unreadable", () => {
  // The session works even if the markup moved the handle somewhere new, and
  // refusing a working session over a cosmetic detail would be the wrong call.
  const check = viewerFromHtml(`<html><script>{"id":"${ID}"}</script></html>`, ID);
  assert.equal(check.loggedIn, true);
  assert.equal(check.username, "");
});

test("a username too far from the id is not claimed as the viewer", () => {
  const check = viewerFromHtml(pageWithViewer("far_away", 5000), ID);
  assert.equal(check.loggedIn, true);
  assert.equal(check.username, "", "beyond the window, so not attributed");
});

test("empty or idless input is handled rather than throwing", () => {
  assert.deepEqual(viewerFromHtml("", ID), {
    loggedIn: false,
    username: "",
    sawLoginPage: false,
  });
  assert.deepEqual(viewerFromHtml("<html></html>", ""), {
    loggedIn: false,
    username: "",
    sawLoginPage: false,
  });
});

test("a partial id cannot masquerade as the account", () => {
  // "id":"3571484412" must not match the account 99900011122.
  const html = `<html><script>{"id":"3571484412","username":"not_us"}</script></html>`;
  assert.equal(viewerFromHtml(html, ID).loggedIn, false);
});
