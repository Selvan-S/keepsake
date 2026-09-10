import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  extractCookies,
  isSessionRejected,
  looksLikeCookieExport,
  parseCredentials,
  redact,
} from "./auth.ts";

const SESSION_ID = "71234567890%3AAbCdEfGhIjKlMn%3A26%3AAYd9xyz";
const DS_USER_ID = "71234567890";
const CSRF = "AbCdEf0123456789XyZq";

const good = { sessionId: SESSION_ID, dsUserId: DS_USER_ID, csrfToken: CSRF };

test("clean values are accepted", () => {
  const parsed = parseCredentials(good);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.credentials, {
    sessionId: SESSION_ID,
    dsUserId: DS_USER_ID,
    csrfToken: CSRF,
  });
});

test("a whole cookie header pasted into one box is understood", () => {
  // People paste what they have. Rejecting this would push them into editing
  // secrets by hand in a text editor, which is worse than parsing it here.
  const header = `Cookie: ig_did=X; sessionid=${SESSION_ID}; ds_user_id=${DS_USER_ID}; csrftoken=${CSRF}; rur=EAG`;
  const parsed = parseCredentials({ sessionId: header, dsUserId: "", csrfToken: "" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.credentials.dsUserId, DS_USER_ID);
  assert.equal(parsed.ok && parsed.credentials.csrfToken, CSRF);
});

test("a cookie-extension JSON export is understood", () => {
  const json = JSON.stringify([
    { name: "sessionid", value: SESSION_ID },
    { name: "ds_user_id", value: DS_USER_ID },
    { name: "csrftoken", value: CSRF },
    { name: "unrelated", value: "ignored" },
  ]);
  const parsed = parseCredentials({ sessionId: json, dsUserId: "", csrfToken: "" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.credentials.sessionId, SESSION_ID);

  // Some extensions wrap the array.
  assert.deepEqual(extractCookies(JSON.stringify({ cookies: [{ name: "csrftoken", value: CSRF }] })), {
    csrftoken: CSRF,
  });
});

test("name=value and quoted values are unwrapped", () => {
  const parsed = parseCredentials({
    sessionId: `sessionid=${SESSION_ID}`,
    dsUserId: `"${DS_USER_ID}"`,
    csrfToken: `csrftoken="${CSRF}"`,
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.credentials.sessionId, SESSION_ID);
  assert.equal(parsed.ok && parsed.credentials.dsUserId, DS_USER_ID);
  assert.equal(parsed.ok && parsed.credentials.csrfToken, CSRF);
});

test("missing fields are named, not lumped into one vague error", () => {
  const parsed = parseCredentials({ sessionId: SESSION_ID, dsUserId: "", csrfToken: "" });
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok === false ? parsed.error : "", /ds_user_id/);
  assert.match(parsed.ok === false ? parsed.error : "", /csrftoken/);
});

test("values of the wrong shape are rejected before a request is spent", () => {
  // The classic mistake: copying the page URL, or the cookie name, or a
  // truncated value.
  const cases = [
    { ...good, sessionId: "https://www.instagram.com/" },
    { ...good, sessionId: "sessionid" },
    { ...good, dsUserId: "not-a-number" },
    { ...good, csrfToken: "short" },
  ];
  for (const input of cases) {
    const parsed = parseCredentials(input);
    assert.equal(parsed.ok, false, JSON.stringify(input).slice(0, 60));
  }
});

test("a swapped sessionid and csrftoken is caught", () => {
  const parsed = parseCredentials({ sessionId: CSRF, dsUserId: DS_USER_ID, csrfToken: SESSION_ID });
  assert.equal(parsed.ok, false);
});

test("the User-Agent is carried when given and omitted when blank", () => {
  const withUa = parseCredentials({ ...good, userAgent: "  Mozilla/5.0 (X11)  " });
  assert.equal(withUa.ok && withUa.credentials.userAgent, "Mozilla/5.0 (X11)");
  const without = parseCredentials({ ...good, userAgent: "   " });
  assert.equal(without.ok && "userAgent" in without.credentials, false);
});

test("session rejection is told apart from ordinary failure", () => {
  assert.equal(isSessionRejected(401, null), true);
  assert.equal(isSessionRejected(200, { message: "login_required" }), true);
  assert.equal(isSessionRejected(200, { message: "checkpoint_required" }), true);
  assert.equal(isSessionRejected(200, { message: "challenge_required" }), true);
  assert.equal(isSessionRejected(403, { requires_login: true }), true);

  // These must keep their own messages: pointing them at "re-paste your
  // cookies" would send the user to fix something that is not broken.
  assert.equal(isSessionRejected(429, { message: "rate limited" }), false);
  assert.equal(isSessionRejected(200, { data: {} }), false);
  assert.equal(isSessionRejected(404, null), false);
});

test("redact never exposes the session token", () => {
  const line = redact({ sessionId: SESSION_ID, dsUserId: DS_USER_ID, csrfToken: CSRF });
  assert.equal(line.includes(SESSION_ID), false);
  assert.equal(line.includes(CSRF), false);
  assert.match(line, /\*\*\*/);
  assert.match(line, new RegExp(DS_USER_ID));
});

test("a Cookie-Editor export pasted as the bundle is the primary path", () => {
  // This is what the extension actually hands you: every cookie for the site,
  // with the fields we need buried among a dozen we do not.
  const exported = JSON.stringify([
    { name: "ig_did", value: "AAA", domain: ".instagram.com", path: "/", secure: true },
    { name: "mid", value: "BBB", domain: ".instagram.com", path: "/" },
    { name: "csrftoken", value: CSRF, domain: ".instagram.com", path: "/" },
    { name: "ds_user_id", value: DS_USER_ID, domain: ".instagram.com", path: "/" },
    { name: "sessionid", value: SESSION_ID, domain: ".instagram.com", path: "/", httpOnly: true },
    { name: "rur", value: "CCC", domain: ".instagram.com", path: "/" },
  ]);
  const parsed = parseCredentials({ bundle: exported });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.credentials, {
    sessionId: SESSION_ID,
    dsUserId: DS_USER_ID,
    csrfToken: CSRF,
  });
});

test("a logged-out export is diagnosed as logged-out, not as an empty form", () => {
  // Exporting from a tab where you are signed out yields real cookies, just
  // not these. "Fill in the boxes" would be unhelpful and wrong.
  const withSome = JSON.stringify([
    { name: "ig_did", value: "AAA" },
    { name: "csrftoken", value: CSRF },
  ]);
  const parsed = parseCredentials({ bundle: withSome });
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok === false ? parsed.error : "", /logged in/);
  assert.match(parsed.ok === false ? parsed.error : "", /sessionid/);

  // And when the export contains none of our three at all -- the actual shape
  // of a logged-out export. It is still a real export, so it must not be
  // dismissed as "not an export".
  const withNone = JSON.stringify([
    { name: "ig_did", value: "AAA", domain: ".instagram.com" },
    { name: "mid", value: "BBB", domain: ".instagram.com" },
  ]);
  const none = parseCredentials({ bundle: withNone });
  assert.equal(none.ok, false);
  assert.match(none.ok === false ? none.error : "", /logged in/);
});

test("a real export is told apart from gibberish, whatever it contains", () => {
  assert.equal(looksLikeCookieExport(JSON.stringify([{ name: "ig_did", value: "A" }])), true);
  assert.equal(looksLikeCookieExport(JSON.stringify({ cookies: [{ name: "mid", value: "B" }] })), true);
  assert.equal(looksLikeCookieExport("sessionid=abc; mid=def"), true);
  assert.equal(looksLikeCookieExport("Cookie: mid=def"), true);

  assert.equal(looksLikeCookieExport("hello"), false);
  assert.equal(looksLikeCookieExport("not json at all"), false);
  assert.equal(looksLikeCookieExport("{}"), false);
  assert.equal(looksLikeCookieExport("[]"), false);
  assert.equal(looksLikeCookieExport('[{"foo":"bar"}]'), false);
  assert.equal(looksLikeCookieExport(""), false);
});

test("an explicit field still wins over the same cookie in the bundle", () => {
  const other = "99999999999%3AZzZzZzZzZz%3A26%3AQQ";
  const parsed = parseCredentials({
    bundle: JSON.stringify([
      { name: "sessionid", value: SESSION_ID },
      { name: "ds_user_id", value: DS_USER_ID },
      { name: "csrftoken", value: CSRF },
    ]),
    sessionId: other,
  });
  assert.equal(parsed.ok && parsed.credentials.sessionId, other);
});

test("a bundle of the wrong kind of JSON is refused, not half-read", () => {
  for (const bundle of ["{}", "[]", '[{"foo":"bar"}]', "not json at all"]) {
    const parsed = parseCredentials({ bundle });
    assert.equal(parsed.ok, false, bundle);
    // Nothing recognisable came out, so the advice is "that is not an export"
    // rather than "your export is missing a cookie" -- different mistakes.
    assert.match(parsed.ok === false ? parsed.error : "", /does not look like a cookie export/, bundle);
  }
});
