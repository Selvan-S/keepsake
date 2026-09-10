/**
 * The web binding for `src/core/instagram`.
 *
 * Everything Instagram-specific lives in core and takes an HttpTransport. This
 * file is the only place that knows about Node globals, environment variables
 * and the media proxy -- which is what lets Phase 4 drop a React Native
 * transport in beside it and reuse core untouched.
 */
import type { ProfileFeed, ProfileTab, ResolveResult } from "@/core/instagram/types";
import { DOC_ID_URL_ENV, loadDocIds, memoizeDocIds } from "@/core/instagram/client/doc-id";
import { InstagramSession } from "@/core/instagram/client/session";
import { globalFetchTransport } from "@/core/instagram/client/transport";
import {
  fetchProfileTab as coreFetchProfileTab,
  resolveInstagramQuery as coreResolveInstagramQuery,
  type InstagramClient,
} from "@/core/instagram/client/endpoints";
import { DEFAULT_USER_AGENT } from "@/core/instagram/client/constants";
import { isAllowedMediaHost } from "./media-url";

const transport = globalFetchTransport();

/**
 * One client for this server process.
 *
 * Single-user by design (see README), so one session is correct here. The
 * session owns its own cookie jar rather than sharing a module-level one, so
 * per-account sessions become a matter of constructing more of these.
 */
const client: InstagramClient = {
  session: new InstagramSession({ transport }),
  docIds: memoizeDocIds(() => loadDocIds({ url: process.env[DOC_ID_URL_ENV], transport })),
};

export function resolveInstagramQuery(query: string): Promise<ResolveResult> {
  return coreResolveInstagramQuery(client, query);
}

export function fetchProfileTab(
  username: string,
  tab: ProfileTab,
  cursor?: string | null,
  userId?: string | null,
): Promise<ProfileFeed> {
  return coreFetchProfileTab(client, username, tab, cursor, userId);
}

/**
 * Refetch a CDN asset server-side.
 *
 * Purely a web concern: Instagram's CDN is hotlink-protected and CORS-blocked,
 * so the browser cannot fetch these directly. React Native has neither problem,
 * which is why this stays out of core and disappears in Phase 4.
 */
export async function fetchRemoteMedia(url: string): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new Response("Invalid media URL", { status: 400 });
  }
  // The host allowlist is what stops this endpoint being an open relay.
  if (parsed.protocol !== "https:" || !isAllowedMediaHost(parsed.hostname)) {
    return new Response("Blocked host", { status: 400 });
  }
  const res = await fetch(parsed.toString(), {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Referer: "https://www.instagram.com/",
      Accept: "image/avif,image/webp,image/*,video/*,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok || !res.body) {
    return new Response("Media unavailable", { status: 502 });
  }
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const length = res.headers.get("content-length");
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "private, max-age=3600",
  });
  if (length) headers.set("content-length", length);
  return new Response(res.body, { status: 200, headers });
}
