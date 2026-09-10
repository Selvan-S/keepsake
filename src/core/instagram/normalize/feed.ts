import type { PostResult, ProfileFeed } from "../types.ts";
import { asArray, asRecord, str } from "./json.ts";
import { mapPost } from "./post.ts";

/** A tab that was fetched and holds nothing. */
export function emptyFeed(): ProfileFeed {
  return { items: [], cursor: null, hasMore: false, loaded: true };
}

/** A tab deliberately not fetched yet. Distinct from a tab that is empty. */
export function deferredFeed(): ProfileFeed {
  return { items: [], cursor: null, hasMore: false, loaded: false };
}

export type TimelinePage = ProfileFeed & { user: Record<string, unknown> | null };

/**
 * Read a timeline GraphQL response.
 *
 * Instagram reports a missing profile as a generic errors array rather than a
 * 404, so the distinction between "no such user" and "something else broke"
 * lives here, in the error text.
 */
export function timelineFromJson(root: Record<string, unknown>, username: string): TimelinePage {
  const errors = asArray(root.errors);
  if (errors.length > 0 && !asRecord(root.data)) {
    const first = asRecord(errors[0]);
    const description = str(first?.description).toLowerCase();
    const summary = str(first?.summary).toLowerCase();
    if (description.includes("user lookup returned null") || summary.includes("bad request")) {
      throw new Error(`No public profile named @${username}.`);
    }
    throw new Error("Could not load that profile.");
  }
  const data = asRecord(root.data);
  const conn = asRecord(data?.xdt_api__v1__feed__user_timeline_graphql_connection);
  if (!conn) {
    throw new Error(`No public profile named @${username}.`);
  }
  const page = asRecord(conn.page_info);
  const items: PostResult[] = [];
  let user: Record<string, unknown> | null = null;
  for (const edge of asArray(conn.edges)) {
    const node = asRecord(asRecord(edge)?.node);
    if (!node) continue;
    if (!user) user = asRecord(node.user);
    const post = mapPost(node);
    // A post with no media cannot be archived, so it is not worth a grid tile.
    if (post.items.length > 0 && post.shortcode) items.push(post);
  }
  return {
    items,
    cursor: str(page?.end_cursor) || null,
    hasMore: Boolean(page?.has_next_page),
    loaded: true,
    user,
  };
}

/** Read a clips/reels response. Reels page by `max_id`, not by cursor. */
export function reelsFromJson(root: Record<string, unknown> | null): ProfileFeed {
  const paging = asRecord(root?.paging_info);
  const items: PostResult[] = [];
  for (const entry of asArray(root?.items)) {
    const media = asRecord(asRecord(entry)?.media) ?? asRecord(entry);
    if (!media) continue;
    const post = mapPost(media);
    if (post.items.length > 0 && post.shortcode) items.push(post);
  }
  return {
    items,
    cursor: str(paging?.max_id) || null,
    hasMore: Boolean(paging?.more_available),
    loaded: true,
  };
}
