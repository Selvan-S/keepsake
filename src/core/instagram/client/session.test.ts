import { strict as assert } from "node:assert";
import { test } from "node:test";
import { InstagramSession } from "./session.ts";
import type { HttpTransport } from "./transport.ts";

const CREDENTIALS = {
  sessionId: "71234567890%3AAbCdEf%3A26%3AAY",
  dsUserId: "71234567890",
  csrfToken: "AbCdEf0123456789XyZq",
};

function stub(response: () => Response = () => new Response("{}")) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const transport: HttpTransport = {
    request: async (url, init) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return response();
    },
  };
  return { transport, calls };
}

test("an anonymous session bootstraps and mints a csrftoken", async () => {
  const { transport, calls } = stub();
  const session = new InstagramSession({ transport, randomToken: () => "minted" });
  await session.bootstrap();
  assert.equal(session.isAuthenticated, false);
  assert.equal(session.cookies.get("csrftoken"), "minted");
  assert.equal(calls.length, 1);
});

test("authenticating replaces anonymous state rather than mixing with it", async () => {
  // A real sessionid travelling with an anonymous csrftoken is a mismatched
  // pair, and looks like a forged request rather than a browser.
  const { transport } = stub();
  const session = new InstagramSession({ transport, randomToken: () => "anon" });
  await session.bootstrap();
  assert.equal(session.cookies.get("csrftoken"), "anon");

  session.authenticate(CREDENTIALS);
  assert.equal(session.isAuthenticated, true);
  assert.equal(session.cookies.get("csrftoken"), CREDENTIALS.csrfToken);
  assert.equal(session.cookies.get("sessionid"), CREDENTIALS.sessionId);
  assert.equal(session.accountId, CREDENTIALS.dsUserId);
});

test("an authenticated session never anonymises itself by bootstrapping", async () => {
  const { transport, calls } = stub();
  const session = new InstagramSession({ transport });
  session.authenticate(CREDENTIALS);
  await session.bootstrap();
  await session.bootstrap(true);
  assert.equal(calls.length, 0, "bootstrap must be a no-op while signed in");
  assert.equal(session.cookies.get("sessionid"), CREDENTIALS.sessionId);
});

test("the User-Agent follows the browser the session was minted in", () => {
  const { transport } = stub();
  const session = new InstagramSession({ transport, userAgent: "DefaultUA" });
  assert.equal(session.userAgent, "DefaultUA");
  session.authenticate({ ...CREDENTIALS, userAgent: "Mozilla/5.0 (RealBrowser)" });
  assert.equal(session.userAgent, "Mozilla/5.0 (RealBrowser)");
  assert.equal(session.headers()["User-Agent"], "Mozilla/5.0 (RealBrowser)");
  // Without one we fall back, rather than sending an empty header.
  session.authenticate(CREDENTIALS);
  assert.equal(session.userAgent, "DefaultUA");
});

test("a cookie-clearing response cannot silently log an authenticated user out", async () => {
  // Instagram rotates cookies and sometimes blanks them on the way. Letting
  // that overwrite a pasted sessionid would end the session mid-archive with
  // no explanation.
  const { transport } = stub(
    () => new Response("{}", { headers: { "set-cookie": 'sessionid=""; Path=/' } }),
  );
  const session = new InstagramSession({ transport, sleep: async () => {} });
  session.authenticate(CREDENTIALS);
  await session.request("https://www.instagram.com/api/v1/x/");
  assert.equal(session.cookies.get("sessionid"), CREDENTIALS.sessionId);
});

test("an anonymous session still accepts cookie updates normally", async () => {
  const { transport } = stub(
    () => new Response("{}", { headers: { "set-cookie": "csrftoken=fromserver; Path=/" } }),
  );
  const session = new InstagramSession({ transport });
  await session.request("https://www.instagram.com/");
  assert.equal(session.cookies.get("csrftoken"), "fromserver");
});

test("authenticated requests are spaced out; anonymous ones are not", async () => {
  const waits: number[] = [];
  const { transport } = stub();
  const session = new InstagramSession({
    transport,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });

  // Anonymous: no throttle at all.
  await Promise.all([session.request("https://x/1"), session.request("https://x/2")]);
  assert.deepEqual(waits, []);

  // Authenticated: cookie-driven traffic is attributable to an account, so it
  // is deliberately slower than anonymous traffic.
  session.authenticate(CREDENTIALS);
  await session.request("https://x/3");
  await session.request("https://x/4");
  assert.equal(waits.length, 1, "the second authenticated request waits");
  assert.ok(waits[0]! > 0);
});

test("signing out drops every cookie, not just the flag", () => {
  const { transport } = stub();
  const session = new InstagramSession({ transport });
  session.authenticate(CREDENTIALS);
  session.signOut();
  assert.equal(session.isAuthenticated, false);
  assert.equal(session.accountId, null);
  assert.equal(session.cookies.size, 0);
  assert.equal(session.cookieHeader(), "");
});
