import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DOC_ID_URL_ENV,
  FALLBACK_DOC_IDS,
  STALE_DOC_ID_MESSAGE,
  assertDocIdAccepted,
  memoizeDocIds,
  isStaleDocIdResponse,
  loadDocIds,
  mergeDocIds,
  parseDocIdConfig,
} from "./doc-id.ts";
import type { HttpTransport } from "./transport.ts";

test("a rejected persisted query is detected across the shapes Meta uses", () => {
  const rejections: Record<string, unknown>[] = [
    { errors: [{ message: "PersistedQueryNotFound" }] },
    { message: "Non-existent doc_id", status: "fail" },
    { errors: [{ description: "The persisted query is not registered", summary: "Bad Request" }] },
    { error_message: "Invalid doc_id supplied" },
    { errors: [{ message: "docId is unknown" }] },
  ];
  for (const root of rejections) {
    assert.equal(isStaleDocIdResponse(root), true, JSON.stringify(root));
  }
});

test("matching is case-insensitive", () => {
  assert.equal(isStaleDocIdResponse({ errors: [{ message: "PERSISTEDQUERYNOTFOUND" }] }), true);
  assert.equal(isStaleDocIdResponse({ message: "Nonexistent DOC_ID" }), true);
});

test("ordinary failures are not mislabelled as a stale doc_id", () => {
  // Each of these is a real thing that goes wrong; sending the reader to the
  // doc_id runbook for any of them would be worse than the generic message.
  const notStale: (Record<string, unknown> | null)[] = [
    null,
    {},
    { data: { xdt_api__v1__feed__user_timeline_graphql_connection: { edges: [] } } },
    { errors: [{ description: "User lookup returned null", summary: "Bad Request" }] },
    { message: "Please wait a few minutes before you try again." },
    { errors: [{ message: "Sorry, something went wrong" }] },
    { message: "checkpoint_required" },
  ];
  for (const root of notStale) {
    assert.equal(isStaleDocIdResponse(root), false, JSON.stringify(root));
  }
});

test("non-string error fields do not crash the scan", () => {
  assert.equal(isStaleDocIdResponse({ message: 42, errors: [null, 7, { description: [] }] }), false);
  assert.equal(isStaleDocIdResponse({ errors: "not-an-array" }), false);
});

test("assertDocIdAccepted throws the runbook message, and is silent otherwise", () => {
  assert.throws(
    () => assertDocIdAccepted({ errors: [{ message: "PersistedQueryNotFound" }] }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "StaleDocIdError");
      assert.equal(error.message, STALE_DOC_ID_MESSAGE);
      assert.match(error.message, /PLAN\.md/);
      return true;
    },
  );
  assert.doesNotThrow(() => assertDocIdAccepted({ data: { ok: true } }));
});

/* -------------------------------------------------------------------------- */
/* Remote configuration                                                        */
/* -------------------------------------------------------------------------- */

const silent = () => {};

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

test("a config document written straight from the PLAN.md runbook is understood", () => {
  const parsed = parseDocIdConfig(
    JSON.stringify({
      POST_DOC_ID: "11111111111",
      TIMELINE_DOC_ID: "22222222222",
      HIGHLIGHTS_TRAY_DOC_ID: "33333333333",
    }),
  );
  assert.deepEqual(parsed, {
    post: "11111111111",
    timeline: "22222222222",
    highlightsTray: "33333333333",
  });
});

test("camelCase keys, a doc_ids wrapper, and JSON numbers all work", () => {
  assert.deepEqual(parseDocIdConfig(JSON.stringify({ post: "12345", highlightsTray: "67890" })), {
    post: "12345",
    highlightsTray: "67890",
  });
  assert.deepEqual(parseDocIdConfig(JSON.stringify({ doc_ids: { timeline: "12345" } })), {
    timeline: "12345",
  });
  assert.deepEqual(parseDocIdConfig(JSON.stringify({ timeline: 27128499623469 })), {
    timeline: "27128499623469",
  });
});

test("malformed values are skipped rather than poisoning the config", () => {
  // A typo in one field must not cost the fields that were written correctly.
  const parsed = parseDocIdConfig(
    JSON.stringify({ post: "not-a-number", timeline: "22222222222", unrelated: "33333333333" }),
  );
  assert.deepEqual(parsed, { timeline: "22222222222" });

  for (const text of ["", "not json", "null", "[]", '"a string"', "{}"]) {
    assert.deepEqual(parseDocIdConfig(text), {}, text);
  }
});

test("a partial document overrides only what it specifies", () => {
  const merged = mergeDocIds(FALLBACK_DOC_IDS, { timeline: "99999999999" });
  assert.equal(merged.timeline, "99999999999");
  assert.equal(merged.post, FALLBACK_DOC_IDS.post);
  assert.equal(merged.highlightsTray, FALLBACK_DOC_IDS.highlightsTray);
});

test("a good remote document is used in place of the built-in ids", async () => {
  const ids = await loadDocIds({
    url: "https://example.test/doc-ids.json",
    transport: { request: async () => jsonResponse(JSON.stringify({ POST_DOC_ID: "44444444444" })) },
    warn: silent,
  });
  assert.equal(ids.post, "44444444444");
  assert.equal(ids.timeline, FALLBACK_DOC_IDS.timeline);
});

test("every remote failure falls back to the built-in ids instead of throwing", async () => {
  const failures: Record<string, HttpTransport> = {
    "network error": {
      request: async () => {
        throw new Error("ECONNREFUSED");
      },
    },
    "http 404": { request: async () => jsonResponse("Not Found", 404) },
    "unparseable body": { request: async () => jsonResponse("<html>rate limited</html>") },
    "no usable ids": { request: async () => jsonResponse(JSON.stringify({ nothing: "useful" })) },
  };
  for (const [name, transport] of Object.entries(failures)) {
    const ids = await loadDocIds({ url: "https://example.test/x", transport, warn: silent });
    assert.deepEqual(ids, FALLBACK_DOC_IDS, name);
  }
});

test("an unset URL falls back and says so loudly", async () => {
  const warnings: string[] = [];
  const ids = await loadDocIds({ url: undefined, warn: (m) => warnings.push(m) });
  assert.deepEqual(ids, FALLBACK_DOC_IDS);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, new RegExp(DOC_ID_URL_ENV));
});

test("the ids are loaded once per client, not per request", async () => {
  let calls = 0;
  const load = () =>
    loadDocIds({
      url: "https://example.test/x",
      transport: {
        request: async () => {
          calls += 1;
          return jsonResponse(JSON.stringify({ post: "55555555555" }));
        },
      },
      warn: silent,
    });

  await Promise.all([load(), load()]);
  assert.equal(calls, 2, "loadDocIds itself is unmemoised; memoizeDocIds is the cache");

  calls = 0;
  const provider = memoizeDocIds(load);
  const [a, b] = await Promise.all([provider(), provider()]);
  assert.equal(calls, 1, "concurrent callers share one in-flight load");
  assert.equal(a, b);
  assert.equal(await provider(), a, "and the result is reused afterwards");
});
