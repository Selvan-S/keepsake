import { asRecord } from "../normalize/json.ts";
import { assertDocIdAccepted } from "./doc-id.ts";
import type { InstagramSession } from "./session.ts";

const GRAPHQL_URL = "https://www.instagram.com/graphql/query";

export const RATE_LIMITED = "Instagram is rate-limiting this network. Wait a moment and try again.";
export const UNEXPECTED = "Instagram returned an unexpected response.";

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Execute one persisted query.
 *
 * The status is returned rather than thrown on, because a 401/403 is a
 * recoverable "your anonymous session went stale" that callers answer by
 * re-bootstrapping, not an error to surface.
 */
export async function graphqlQuery(
  session: InstagramSession,
  docId: string,
  variables: Record<string, unknown>,
  timeoutMs = 20000,
): Promise<{ status: number; root: Record<string, unknown> }> {
  await session.bootstrap();
  const body = new URLSearchParams({
    variables: JSON.stringify(variables),
    doc_id: docId,
    server_timestamps: "true",
  });
  const res = await session.request(GRAPHQL_URL, {
    method: "POST",
    headers: session.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (res.status === 429) throw new Error(RATE_LIMITED);

  const root = safeParse(text);
  // A login wall does not necessarily return JSON, so hand the status back
  // before insisting on a parseable body.
  if (res.status === 401 || res.status === 403) return { status: res.status, root: root ?? {} };
  if (!root) throw new Error(UNEXPECTED);
  // Ahead of every caller's own error mapping: the timeline in particular turns
  // a "bad request" summary into "no such profile", which would hide a stale id
  // behind a confident, wrong answer.
  assertDocIdAccepted(root);
  return { status: res.status, root };
}
