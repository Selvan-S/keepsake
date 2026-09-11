import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FALLBACK_DOC_IDS } from "./doc-id.ts";
import { fetchProfile, fetchProfileTab, verifySession, type InstagramClient } from "./endpoints.ts";
import { InstagramSession } from "./session.ts";
import type { HttpTransport } from "./transport.ts";

/**
 * The whole point of the transport seam: the endpoints can be exercised without
 * a network, so what a search actually costs is something we can assert on
 * rather than something we hope about.
 */
function stubClient(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = [];
  const transport: HttpTransport = {
    request: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      return handler(url, init);
    },
  };
  const client: InstagramClient = {
    session: new InstagramSession({ transport, randomToken: () => "testtoken", sleep: async () => {} }),
    docIds: async () => FALLBACK_DOC_IDS,
  };
  return { client, calls };
}

const TIMELINE = JSON.stringify({
  data: {
    xdt_api__v1__feed__user_timeline_graphql_connection: {
      edges: [
        {
          node: {
            code: "ABC123",
            taken_at: 111,
            like_count: 5,
            user: { pk: "42", username: "probe", full_name: "Probe" },
            image_versions2: {
              candidates: [
                { url: "https://cdn.test/small_s150x150.jpg", width: 150, height: 150 },
                { url: "https://cdn.test/big.jpg", width: 1080, height: 1080 },
              ],
            },
          },
        },
      ],
      page_info: { end_cursor: "CUR", has_next_page: true },
    },
  },
});

test("a profile search costs one bootstrap plus one timeline request", async () => {
  // This is the account-safety guarantee, not a style preference: fanning out
  // to reels/stories/highlights here cost ~8 requests in a burst.
  const { client, calls } = stubClient((url) =>
    url.includes("/graphql/query") ? new Response(TIMELINE) : new Response("{}"),
  );
  const profile = await fetchProfile(client, "probe");

  assert.equal(calls.length, 2, calls.join(" | "));
  assert.deepEqual(calls, ["GET https://www.instagram.com/", "POST https://www.instagram.com/graphql/query"]);
  assert.equal(profile.posts.loaded, true);
  assert.equal(profile.posts.items.length, 1);
  for (const tab of ["reels", "stories", "highlights"] as const) {
    assert.equal(profile[tab].loaded, false, `${tab} must be deferred, not fetched`);
  }
});

test("the deferred tabs are still reachable on demand", async () => {
  const { client, calls } = stubClient((url) => {
    if (url.includes("/graphql/query")) return new Response(TIMELINE);
    if (url.includes("/clips/user/")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              media: {
                code: "REEL1",
                product_type: "clips",
                media_type: 2,
                video_versions: [{ url: "https://cdn.test/r.mp4", width: 720, height: 1280 }],
              },
            },
          ],
          paging_info: { max_id: "M1", more_available: true },
        }),
      );
    }
    return new Response("{}");
  });

  const reels = await fetchProfileTab(client, "probe", "reels", null, "42");
  assert.equal(reels.loaded, true);
  assert.equal(reels.items.length, 1);
  assert.equal(reels.items[0]!.kind, "reel");
  assert.equal(reels.cursor, "M1");
  assert.equal(reels.hasMore, true);
  // Bootstrap + the clips call. A known userId must not cost a profile lookup.
  assert.equal(calls.length, 2, calls.join(" | "));
});

test("a stale doc_id surfaces the runbook error rather than 'no such profile'", async () => {
  // The timeline maps a "bad request" summary to "no public profile named @x",
  // which would hide a rotation behind a confident, wrong answer.
  const { client } = stubClient((url) =>
    url.includes("/graphql/query")
      ? new Response(JSON.stringify({ errors: [{ message: "PersistedQueryNotFound" }] }))
      : new Response("{}"),
  );
  await assert.rejects(fetchProfile(client, "probe"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "StaleDocIdError");
    assert.match(error.message, /PLAN\.md/);
    return true;
  });
});

test("a private profile with nothing visible is reported as private", async () => {
  const { client } = stubClient((url) =>
    url.includes("/graphql/query")
      ? new Response(
          JSON.stringify({
            data: {
              xdt_api__v1__feed__user_timeline_graphql_connection: {
                // A private account still returns a user node, with no media.
                edges: [{ node: { code: "X", user: { pk: "7", username: "probe", is_private: true } } }],
                page_info: { end_cursor: null, has_next_page: false },
              },
            },
          }),
        )
      : new Response("{}"),
  );
  await assert.rejects(fetchProfile(client, "probe"), /is private/);
});

test("a real but empty profile resolves rather than erroring", async () => {
  // An account with no posts is not a failure, and must not be reported as a
  // missing profile.
  const { client } = stubClient((url) =>
    url.includes("/graphql/query")
      ? new Response(
          JSON.stringify({
            data: {
              xdt_api__v1__feed__user_timeline_graphql_connection: {
                edges: [],
                page_info: { end_cursor: null, has_next_page: false },
              },
            },
          }),
        )
      : new Response("{}"),
  );
  const profile = await fetchProfile(client, "probe");
  assert.equal(profile.username, "probe");
  assert.equal(profile.posts.items.length, 0);
  // Without a user node there is no id, so the other tabs can never be fetched
  // later either -- they are loaded-and-empty, not deferred.
  assert.equal(profile.reels.loaded, true);
});

test("a missing profile is reported as missing", async () => {
  const { client } = stubClient((url) =>
    url.includes("/graphql/query")
      ? new Response(JSON.stringify({ errors: [{ description: "User lookup returned null" }] }))
      : new Response("{}"),
  );
  await assert.rejects(fetchProfile(client, "probe"), /No public profile named @probe/);
});

test("rate limiting is reported as itself, not as a missing profile", async () => {
  const { client } = stubClient((url) =>
    url.includes("/graphql/query") ? new Response("nope", { status: 429 }) : new Response("{}"),
  );
  await assert.rejects(fetchProfile(client, "probe"), /rate-limiting/);
});

test("each session owns its cookie jar", async () => {
  // Phase 3 needs per-account sessions; a module-level jar would make that
  // impossible and would leak one account's cookies into another's requests.
  const make = () =>
    stubClient(
      () =>
        new Response("{}", {
          headers: { "set-cookie": `csrftoken=tok-${Math.random()}; Path=/` },
        }),
    ).client.session;
  const a = make();
  const b = make();
  await a.bootstrap();
  await b.bootstrap();
  assert.notEqual(a.cookies.get("csrftoken"), b.cookies.get("csrftoken"));
});

/* -------------------------------------------------------------------------- */
/* Authenticated session                                                       */
/* -------------------------------------------------------------------------- */

const CREDENTIALS = {
  sessionId: "71234567890%3AAbCdEf%3A26%3AAY",
  dsUserId: "71234567890",
  csrfToken: "AbCdEf0123456789XyZq",
};

test("verifySession reports the account when Instagram accepts the cookies", async () => {
  // Measured against the live site: the JSON routes do not answer, but a
  // logged-in homepage embeds the viewer's own profile beside their id.
  const { client, calls } = stubClient(
    () =>
      new Response(
        `<!DOCTYPE html><html><script>{"id":"71234567890","username":"throwaway"}</script></html>`,
      ),
  );
  client.session.authenticate(CREDENTIALS);
  const result = await verifySession(client);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.username, "throwaway");
  // One request, and the least interesting one available.
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "GET https://www.instagram.com/");
});

test("verifySession reports a refused login as refused", async () => {
  const { client } = stubClient(
    () =>
      new Response(
        '<!DOCTYPE html><html><form action="/accounts/login/" method="post"></form></html>',
      ),
  );
  client.session.authenticate(CREDENTIALS);
  const result = await verifySession(client);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /not being accepted/);
});

test("verifySession keeps a working session whose handle it cannot read", async () => {
  // Refusing a session that demonstrably works, because the markup moved a
  // cosmetic field, would be the wrong trade.
  const { client } = stubClient(
    () => new Response(`<!DOCTYPE html><html><script>{"id":"71234567890"}</script></html>`),
  );
  client.session.authenticate(CREDENTIALS);
  const result = await verifySession(client);
  assert.equal(result.ok, true);
  assert.match(result.ok ? result.username : "", /71234567890/);
});

test("verifySession keeps rate limiting distinct from a bad login", async () => {
  // Telling someone to re-paste cookies that are fine would send them to fix
  // the wrong thing.
  const { client } = stubClient(() => new Response("nope", { status: 429 }));
  client.session.authenticate(CREDENTIALS);
  const result = await verifySession(client);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /rate-limiting/);
});

test("verifySession refuses to guess when no session is configured", async () => {
  const { client, calls } = stubClient(() => new Response("{}"));
  const result = await verifySession(client);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0, "no request without a session to verify");
});

test("a rejected session during a search says to re-paste, not 'no such post'", async () => {
  const { client } = stubClient(
    () => new Response(JSON.stringify({ message: "login_required" }), { status: 401 }),
  );
  client.session.authenticate(CREDENTIALS);
  const { fetchPost } = await import("./endpoints.ts");
  await assert.rejects(fetchPost(client, "ABC123"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "SessionRejectedError");
    assert.match(error.message, /expired/);
    return true;
  });
});
