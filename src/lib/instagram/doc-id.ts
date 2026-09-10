/**
 * Instagram's GraphQL uses persisted queries: the client sends a `doc_id`
 * number, not the query text. Those ids go stale whenever Meta redeploys a
 * changed query shape, and the resulting failure looks like a bug in otherwise
 * working code. See the "doc_id problem" section of PLAN.md for the runbook.
 */

export const STALE_DOC_ID_MESSAGE =
  "Instagram changed its internal API — the doc_ids need refreshing (see the doc_id runbook in PLAN.md).";

export class StaleDocIdError extends Error {
  constructor() {
    super(STALE_DOC_ID_MESSAGE);
    this.name = "StaleDocIdError";
  }
}

/**
 * Strings Meta puts in a response when it does not recognise the persisted
 * query. Matched case-insensitively against the error fields collected below.
 *
 * These are deliberately narrow: a normal success, a private profile and a
 * missing user never mention a persisted query, so a match here is a strong
 * signal rather than a guess. Anything vaguer ("something went wrong") is left
 * out on purpose — mislabelling an outage as a stale id would send the reader
 * to the wrong runbook.
 */
const STALE_MARKERS = [
  "persistedquerynotfound",
  "persisted query",
  "doc_id",
  "docid",
  "nonexistent doc",
  "non-existent doc",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pushIfString(into: string[], value: unknown) {
  if (typeof value === "string" && value) into.push(value);
}

/**
 * Collect the fields Meta actually uses to explain a GraphQL rejection. The
 * shape is not stable across endpoints, so read all of them rather than betting
 * on one.
 */
function rejectionStrings(root: Record<string, unknown> | null): string[] {
  if (!root) return [];
  const out: string[] = [];
  pushIfString(out, root.message);
  pushIfString(out, root.error_message);
  pushIfString(out, root.error_type);
  const errors = Array.isArray(root.errors) ? root.errors : [];
  for (const entry of errors) {
    const rec = asRecord(entry);
    if (!rec) continue;
    pushIfString(out, rec.message);
    pushIfString(out, rec.description);
    pushIfString(out, rec.summary);
  }
  return out;
}

/**
 * True when a GraphQL response is Instagram refusing the persisted query id
 * itself, rather than refusing the thing we asked for.
 */
export function isStaleDocIdResponse(root: Record<string, unknown> | null): boolean {
  return rejectionStrings(root).some((text) => {
    const lower = text.toLowerCase();
    return STALE_MARKERS.some((marker) => lower.includes(marker));
  });
}

/** Throw the runbook-naming error if the response is a rejected `doc_id`. */
export function assertDocIdAccepted(root: Record<string, unknown> | null): void {
  if (isStaleDocIdResponse(root)) throw new StaleDocIdError();
}
