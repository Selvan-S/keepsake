import { strict as assert } from "node:assert";
import { test } from "node:test";
import { STALE_DOC_ID_MESSAGE, assertDocIdAccepted, isStaleDocIdResponse } from "./doc-id.ts";

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
