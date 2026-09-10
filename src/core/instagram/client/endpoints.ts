import type { PostResult, ProfileFeed, ProfileResult, ProfileTab, ResolveResult } from "../types.ts";
import { parseQuery, shortcodeFromHtml, shortcodeFromRedirectTarget } from "../parse.ts";
import { asArray, asRecord, str } from "../normalize/json.ts";
import { deferredFeed, emptyFeed, reelsFromJson, timelineFromJson } from "../normalize/feed.ts";
import {
  applyHighlightTitles,
  highlightTrayFromJson,
  postsFromReels,
  reelsMediaFromJson,
} from "../normalize/highlights.ts";
import { mapPost } from "../normalize/post.ts";
import { profileFromUser } from "../normalize/profile.ts";
import { PREVIEW_COUNT } from "./constants.ts";
import { graphqlQuery } from "./graphql.ts";
import type { DocIdProvider } from "./doc-id.ts";
import type { InstagramSession } from "./session.ts";

/** Everything an endpoint needs, with no platform types in sight. */
export type InstagramClient = {
  session: InstagramSession;
  docIds: DocIdProvider;
};

const SHARE_LINK_FAILED =
  "That share link didn’t open. Open the post, tap Share → Copy link, and paste it again.";

/**
 * Follow a /share/ link to the post it stands for. Instagram answers these
 * sometimes with a redirect and sometimes with a rendered page, so both are
 * tried before giving up.
 */
async function resolveShareUrl(client: InstagramClient, href: string, depth = 0): Promise<string> {
  if (depth > 3) throw new Error(SHARE_LINK_FAILED);
  const { session } = client;
  await session.bootstrap();
  const headers = session.documentHeaders();

  const res = await session.request(href, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const location = res.headers.get("location");
  if (location) {
    if (/\/stories\//i.test(location) || /\/s\//.test(location)) {
      throw new Error("Stories aren’t available. Copy the post or reel link instead.");
    }
    const code = shortcodeFromRedirectTarget(location);
    if (code) return code;
    try {
      const next = new URL(location, "https://www.instagram.com");
      if (next.pathname.includes("/share/")) {
        return resolveShareUrl(client, next.toString(), depth + 1);
      }
    } catch {
      /* a malformed Location is not worth failing over; fall through */
    }
  }

  const followed = await session.request(href, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  const fromFinal = shortcodeFromRedirectTarget(followed.url);
  if (fromFinal) return fromFinal;
  const fromHtml = shortcodeFromHtml(await followed.text());
  if (fromHtml) return fromHtml;
  throw new Error(SHARE_LINK_FAILED);
}

export async function fetchPost(
  client: InstagramClient,
  shortcode: string,
  retried = false,
): Promise<PostResult> {
  const docIds = await client.docIds();
  const { status, root } = await graphqlQuery(
    client.session,
    docIds.post,
    {
      shortcode,
      __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
    },
    15000,
  );

  if (status === 401 || status === 403) {
    if (!retried) {
      await client.session.bootstrap(true);
      return fetchPost(client, shortcode, true);
    }
    throw new Error(
      "Instagram asked for a login wall. Public posts usually still work — try again.",
    );
  }

  const info = asRecord(asRecord(root.data)?.xdt_api__v1__media__shortcode__web_info);
  const first = asRecord(asArray(info?.items)[0]);
  if (!first) {
    // A login-wall message can arrive with a 200, so re-bootstrap on the text
    // as well as on the status.
    if (str(root.message).toLowerCase().includes("login") && !retried) {
      await client.session.bootstrap(true);
      return fetchPost(client, shortcode, true);
    }
    throw new Error("Could not find that post. It may be private, deleted, or age-gated.");
  }
  const post = mapPost(first);
  if (post.items.length === 0) throw new Error("That post has no downloadable media.");
  return post;
}

async function fetchTimelinePage(client: InstagramClient, username: string, cursor?: string | null) {
  const variables: Record<string, unknown> = {
    data: {
      count: PREVIEW_COUNT,
      include_relationship_info: true,
      latest_besties_reel_media: true,
      latest_reel_media: true,
    },
    username,
    __relay_internal__pv__PolarisFeedShareMenurelayprovider: false,
  };
  if (cursor) variables.after = cursor;
  const docIds = await client.docIds();
  const { root } = await graphqlQuery(client.session, docIds.timeline, variables);
  return timelineFromJson(root, username);
}

async function fetchReelsPage(
  client: InstagramClient,
  userId: string,
  cursor?: string | null,
): Promise<ProfileFeed> {
  const { session } = client;
  await session.bootstrap();
  const params: Record<string, string> = {
    target_user_id: userId,
    page_size: "12",
    include_feed_video: "true",
  };
  if (cursor) params.max_id = cursor;
  const res = await session.request("https://www.instagram.com/api/v1/clips/user/", {
    method: "POST",
    headers: session.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams(params),
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) return emptyFeed();
  try {
    return reelsFromJson(asRecord(JSON.parse(text)));
  } catch {
    return emptyFeed();
  }
}

async function fetchReelsMedia(
  client: InstagramClient,
  reelIds: string[],
): Promise<Record<string, unknown>[]> {
  if (reelIds.length === 0) return [];
  const { session } = client;
  await session.bootstrap();
  const qs = reelIds.map((id) => encodeURIComponent(id)).join(",");
  const res = await session.request(
    `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${qs}`,
    {
      headers: session.headers({ Accept: "application/json" }),
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    },
  );
  const text = await res.text();
  try {
    return reelsMediaFromJson(asRecord(JSON.parse(text)));
  } catch {
    return [];
  }
}

async function fetchStories(client: InstagramClient, userId: string): Promise<ProfileFeed> {
  try {
    const reels = await fetchReelsMedia(client, [userId]);
    return { items: postsFromReels(reels, "story"), cursor: null, hasMore: false, loaded: true };
  } catch {
    return emptyFeed();
  }
}

async function fetchHighlightTray(client: InstagramClient, userId: string) {
  try {
    const docIds = await client.docIds();
    const { root } = await graphqlQuery(client.session, docIds.highlightsTray, {
      user_id: userId,
      include_chaining: false,
      include_reel: true,
      include_suggested_users: false,
      include_logged_out_extras: true,
      include_highlight_reels: true,
      include_live_status: true,
    });
    return highlightTrayFromJson(root);
  } catch (error) {
    // Highlights are best-effort and a failure here must not sink a profile
    // load -- but a stale id is a configuration problem the user can act on, so
    // it propagates rather than showing a silently empty tab.
    if (error instanceof Error && error.name === "StaleDocIdError") throw error;
    return { hasPublicStory: false, highlights: [] };
  }
}

async function fetchHighlights(
  client: InstagramClient,
  userId: string,
): Promise<{ feed: ProfileFeed; hasPublicStory: boolean }> {
  const tray = await fetchHighlightTray(client, userId);
  if (tray.highlights.length === 0) {
    return { feed: emptyFeed(), hasPublicStory: tray.hasPublicStory };
  }
  const reelIds = tray.highlights.slice(0, 24).map((h) => `highlight:${h.id}`);
  const reels: Record<string, unknown>[] = [];
  // Chunked because the id list goes in the query string; sequential because a
  // burst of these is exactly the pattern that gets an address blocked.
  for (let i = 0; i < reelIds.length; i += 8) {
    reels.push(...(await fetchReelsMedia(client, reelIds.slice(i, i + 8))));
  }
  applyHighlightTitles(reels, tray.highlights);
  return {
    feed: {
      items: postsFromReels(reels, "highlight"),
      cursor: null,
      hasMore: false,
      loaded: true,
    },
    hasPublicStory: tray.hasPublicStory,
  };
}

/**
 * Resolve a profile using a single timeline request.
 *
 * This deliberately does not fan out to reels, stories and highlights. Doing so
 * cost five to seven requests in a burst on every search -- including three for
 * a highlights tray most searches never open -- and burst request volume from
 * one address is the pattern Instagram blocks on. Those tabs are marked
 * unloaded and fetched by `fetchProfileTab` when the user opens one.
 */
export async function fetchProfile(
  client: InstagramClient,
  username: string,
): Promise<ProfileResult> {
  const timeline = await fetchTimelinePage(client, username);
  if (timeline.user && Boolean(timeline.user.is_private) && timeline.items.length === 0) {
    throw new Error(`@${username} is private. Keepsake only reads public media.`);
  }
  const posts: ProfileFeed = {
    items: timeline.items,
    cursor: timeline.cursor,
    hasMore: timeline.hasMore,
    loaded: true,
  };
  const userId = str(timeline.user?.pk) || str(timeline.user?.id);
  if (!userId) {
    // Without an id the other tabs cannot be fetched later either, so report
    // them as loaded-and-empty rather than leaving the UI waiting on them.
    return profileFromUser(
      username,
      timeline.user,
      posts,
      emptyFeed(),
      emptyFeed(),
      emptyFeed(),
      false,
    );
  }
  // hasPublicStory came from the highlights tray, which is no longer fetched
  // here; the stories tab reports what it finds when it is opened.
  return profileFromUser(
    username,
    timeline.user,
    posts,
    deferredFeed(),
    deferredFeed(),
    deferredFeed(),
    false,
  );
}

export async function fetchProfileTab(
  client: InstagramClient,
  username: string,
  tab: ProfileTab,
  cursor?: string | null,
  userId?: string | null,
): Promise<ProfileFeed> {
  if (tab === "posts") {
    const page = await fetchTimelinePage(client, username, cursor);
    return { items: page.items, cursor: page.cursor, hasMore: page.hasMore, loaded: true };
  }
  let id = userId || "";
  if (!id) {
    const lookup = await fetchTimelinePage(client, username);
    id = str(lookup.user?.pk) || str(lookup.user?.id);
  }
  if (!id) return emptyFeed();
  if (tab === "reels") return fetchReelsPage(client, id, cursor);
  if (tab === "stories") return fetchStories(client, id);
  return (await fetchHighlights(client, id)).feed;
}

export async function resolveInstagramQuery(
  client: InstagramClient,
  query: string,
): Promise<ResolveResult> {
  const parsed = parseQuery(query);
  if (parsed.items.length === 0) {
    return {
      ok: false,
      error: parsed.error || "Paste a username, profile link, or a public post / reel link.",
    };
  }
  try {
    const postItems = parsed.items.filter((p) => p.kind === "post" || p.kind === "share");
    const profiles = parsed.items.filter((p) => p.kind === "profile");
    if (postItems.length > 0) {
      const results: PostResult[] = [];
      for (const item of postItems.slice(0, 8)) {
        const shortcode =
          item.kind === "share" ? await resolveShareUrl(client, item.href) : item.shortcode;
        results.push(await fetchPost(client, shortcode));
      }
      return { ok: true, mode: "post", posts: results };
    }
    const profileQuery = profiles[0];
    if (!profileQuery || profileQuery.kind !== "profile") {
      return { ok: false, error: "Paste a username, profile link, or a public post / reel link." };
    }
    return { ok: true, mode: "profile", profile: await fetchProfile(client, profileQuery.username) };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong talking to Instagram.";
    return { ok: false, error: message };
  }
}
