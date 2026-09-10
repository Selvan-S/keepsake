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

/* -------------------------------------------------------------------------- */
/* Remote configuration                                                        */
/* -------------------------------------------------------------------------- */

export type DocIds = {
  post: string;
  timeline: string;
  highlightsTray: string;
};

/**
 * The ids compiled into this build. Every installed copy freezes at these, so
 * they are the floor rather than the source of truth — see `loadDocIds`.
 */
export const FALLBACK_DOC_IDS: DocIds = {
  post: "27128499623469141",
  timeline: "34579740524958711",
  highlightsTray: "9957820854288654",
};

/** Env var naming a URL that serves the current ids as JSON. */
export const DOC_ID_URL_ENV = "KEEPSAKE_DOC_ID_URL";

/**
 * Accepted key spellings. The runbook in PLAN.md calls these POST_DOC_ID,
 * TIMELINE_DOC_ID and HIGHLIGHTS_TRAY_DOC_ID, so a file written straight from
 * the runbook should work without a translation step.
 */
const KEY_ALIASES: Record<string, keyof DocIds> = {
  post: "post",
  postdocid: "post",
  timeline: "timeline",
  timelinedocid: "timeline",
  highlights: "highlightsTray",
  highlightstray: "highlightsTray",
  highlightstraydocid: "highlightsTray",
};

/** doc_ids are long decimal strings. Anything else is a typo or a stray value. */
const DOC_ID_PATTERN = /^\d{5,32}$/;

function normaliseKey(key: string): keyof DocIds | null {
  return KEY_ALIASES[key.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

/**
 * Read whatever ids a config document specifies. Unknown keys and malformed
 * values are skipped rather than throwing: a partial or slightly wrong file
 * should still deliver the ids it did get right, with the build's own values
 * covering the rest.
 */
export function parseDocIdConfig(text: string): Partial<DocIds> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const root = asRecord(json);
  if (!root) return {};
  const source = asRecord(root.doc_ids) ?? asRecord(root.docIds) ?? root;
  const out: Partial<DocIds> = {};
  for (const [key, value] of Object.entries(source)) {
    const field = normaliseKey(key);
    if (!field) continue;
    const raw = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof raw !== "string" || !DOC_ID_PATTERN.test(raw)) continue;
    out[field] = raw;
  }
  return out;
}

/** Merge a remote document over the compiled-in ids, field by field. */
export function mergeDocIds(base: DocIds, override: Partial<DocIds>): DocIds {
  return {
    post: override.post ?? base.post,
    timeline: override.timeline ?? base.timeline,
    highlightsTray: override.highlightsTray ?? base.highlightsTray,
  };
}

export type DocIdLoadOptions = {
  url?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  warn?: (message: string) => void;
};

/**
 * Resolve the ids to use, preferring a remotely hosted document so a rotation
 * can be fixed by editing one file instead of rebuilding and redistributing
 * every APK. Any failure falls back to the compiled-in ids: stale ids that at
 * least produce the runbook error beat refusing to start.
 */
export async function loadDocIds(options: DocIdLoadOptions = {}): Promise<DocIds> {
  const {
    url,
    fetchImpl = fetch,
    timeoutMs = 5000,
    warn = (message: string) => console.warn(message),
  } = options;

  if (!url) {
    // Deliberately loud. An unset URL means this copy can never be corrected
    // remotely, which is the exact failure this mechanism exists to prevent.
    warn(
      `[keepsake] ${DOC_ID_URL_ENV} is not set — using the doc_ids compiled into this build. ` +
        "If they go stale, this copy has to be rebuilt to recover.",
    );
    return FALLBACK_DOC_IDS;
  }

  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      warn(`[keepsake] doc_id config at ${url} returned ${res.status} — using built-in ids.`);
      return FALLBACK_DOC_IDS;
    }
    const parsed = parseDocIdConfig(await res.text());
    if (Object.keys(parsed).length === 0) {
      warn(`[keepsake] doc_id config at ${url} had no usable ids — using built-in ids.`);
      return FALLBACK_DOC_IDS;
    }
    return mergeDocIds(FALLBACK_DOC_IDS, parsed);
  } catch {
    warn(`[keepsake] could not read doc_id config at ${url} — using built-in ids.`);
    return FALLBACK_DOC_IDS;
  }
}

let docIdsPromise: Promise<DocIds> | null = null;

/**
 * The ids for this process, loaded once on first use. Memoised on the promise
 * so concurrent callers share a single request; a failed load still resolves
 * (to the fallback), so this never retries a dead URL on every request.
 */
export function getDocIds(): Promise<DocIds> {
  docIdsPromise ??= loadDocIds({ url: process.env[DOC_ID_URL_ENV] });
  return docIdsPromise;
}

/** Test seam: drop the memoised load. */
export function resetDocIdsForTest(): void {
  docIdsPromise = null;
}
