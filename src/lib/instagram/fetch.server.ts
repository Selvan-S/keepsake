import type {
  MediaItem,
  PostKind,
  PostResult,
  ProfileFeed,
  ProfileResult,
  ProfileTab,
  ResolveResult,
} from "./types";
import { parseQuery, shortcodeFromRedirectTarget } from "./parse";
import { isAllowedMediaHost } from "./media-url";
import { StaleDocIdError, assertDocIdAccepted, getDocIds } from "./doc-id";

const IG_APP_ID = "936619743392459";
const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.94 Mobile Safari/537.36";

const jar = new Map<string, string>();
let bootstrapping: Promise<void> | null = null;

function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(res: Response) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const pair = c.split(";")[0];
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function bootstrapSession(force = false) {
  if (!force && jar.has("csrftoken")) return;
  if (bootstrapping) return bootstrapping;
  bootstrapping = (async () => {
    if (force) jar.clear();
    const res = await fetch("https://www.instagram.com/", {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    storeCookies(res);
    await res.arrayBuffer();
    if (!jar.has("csrftoken")) {
      jar.set("csrftoken", crypto.randomUUID().replace(/-/g, "").slice(0, 32));
    }
  })().finally(() => {
    bootstrapping = null;
  });
  return bootstrapping;
}

function igHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://www.instagram.com",
    Referer: "https://www.instagram.com/",
    "X-CSRFToken": jar.get("csrftoken") || "",
    "X-IG-App-ID": IG_APP_ID,
    "X-Requested-With": "XMLHttpRequest",
    Cookie: cookieHeader(),
    ...extra,
  };
}

function upgradeImageUrl(url: string): string {
  return url.replace(/_s\d+x\d+/g, "");
}

function pickBest(
  versions: unknown,
  urlKey: "url",
): { url: string; width: number; height: number } | null {
  let best: { url: string; width: number; height: number } | null = null;
  let area = -1;
  for (const entry of asArray(versions)) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const url = str(rec[urlKey]);
    if (!url) continue;
    const width = num(rec.width);
    const height = num(rec.height);
    const score = width * height || 1;
    if (score > area) {
      area = score;
      best = { url, width: width || 0, height: height || 0 };
    }
  }
  return best;
}

function mediaFromNode(node: Record<string, unknown>, id: string): MediaItem[] {
  const videos = pickBest(node.video_versions, "url");
  const images = pickBest(asRecord(node.image_versions2)?.candidates, "url");
  const items: MediaItem[] = [];
  if (videos) {
    items.push({
      id: `${id}-video`,
      kind: "video",
      url: videos.url,
      thumbnailUrl: images ? upgradeImageUrl(images.url) : videos.url,
      width: videos.width,
      height: videos.height,
    });
  } else if (images) {
    const url = upgradeImageUrl(images.url);
    items.push({
      id: `${id}-image`,
      kind: "image",
      url,
      thumbnailUrl: url,
      width: images.width,
      height: images.height,
    });
  }
  return items;
}

function kindFromItem(item: Record<string, unknown>): PostKind {
  const mediaType = num(item.media_type);
  const product = str(item.product_type);
  if (product === "story") return "story";
  if (product === "highlights" || product === "story_highlight") return "highlight";
  if (product === "clips" || product === "igtv") return "reel";
  if (mediaType === 8) return "carousel";
  if (mediaType === 2) return "video";
  return "image";
}

function mapPost(item: Record<string, unknown>): PostResult {
  const shortcode = str(item.code) || str(item.shortcode) || str(item.pk) || str(item.id);
  const user = asRecord(item.user) ?? asRecord(item.owner) ?? {};
  const captionNode = asRecord(item.caption);
  const caption = str(captionNode?.text);
  const kind = kindFromItem(item);
  const carousel = asArray(item.carousel_media);
  const items: MediaItem[] =
    carousel.length > 0
      ? carousel.flatMap((slide, index) => {
          const rec = asRecord(slide);
          if (!rec) return [];
          return mediaFromNode(rec, `${shortcode}-${index}`);
        })
      : mediaFromNode(item, shortcode);

  const hdPic = asRecord(user.hd_profile_pic_url_info);
  const pathKind =
    kind === "reel" ? "reel" : kind === "story" || kind === "highlight" ? "stories" : "p";
  return {
    shortcode,
    url: `https://www.instagram.com/${pathKind}/${shortcode}/`,
    kind,
    takenAt: num(item.taken_at) || null,
    caption,
    likeCount: num(item.like_count),
    commentCount: num(item.comment_count),
    owner: {
      username: str(user.username),
      fullName: str(user.full_name),
      profilePicUrl: str(hdPic?.url) || str(user.profile_pic_url) || null,
    },
    items,
    complete: items.length > 0,
    highlightTitle: str(item.title) || undefined,
  };
}

function shortcodeFromHtml(html: string): string | null {
  const attrs = [
    html.match(/rel="canonical"\s+href="([^"]+)"/i)?.[1],
    html.match(/href="([^"]+)"\s+rel="canonical"/i)?.[1],
    html.match(/property="og:url"\s+content="([^"]+)"/i)?.[1],
  ];
  for (const value of attrs) {
    if (!value) continue;
    const code = shortcodeFromRedirectTarget(value.replace(/&/g, "&"));
    if (code) return code;
  }
  return null;
}

async function resolveShareUrl(href: string, depth = 0): Promise<string> {
  if (depth > 3) {
    throw new Error("That share link didn’t open. Open the post, tap Share → Copy link, and paste it again.");
  }
  await bootstrapSession();
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: cookieHeader(),
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
  };
  const res = await fetch(href, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  storeCookies(res);
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
        return resolveShareUrl(next.toString(), depth + 1);
      }
    } catch {
      /* ignore */
    }
  }

  const followed = await fetch(href, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  storeCookies(followed);
  const fromFinal = shortcodeFromRedirectTarget(followed.url);
  if (fromFinal) return fromFinal;
  const html = await followed.text();
  const fromHtml = shortcodeFromHtml(html);
  if (fromHtml) return fromHtml;
  throw new Error("That share link didn’t open. Open the post, tap Share → Copy link, and paste it again.");
}

async function graphqlPost(shortcode: string, retried = false): Promise<PostResult> {
  const [docIds] = await Promise.all([getDocIds(), bootstrapSession()]);
  const body = new URLSearchParams({
    variables: JSON.stringify({
      shortcode,
      __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
    }),
    doc_id: docIds.post,
    server_timestamps: "true",
  });
  const res = await fetch("https://www.instagram.com/graphql/query", {
    method: "POST",
    headers: igHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  storeCookies(res);
  const text = await res.text();
  if (res.status === 429) {
    throw new Error("Instagram is rate-limiting this network. Wait a moment and try again.");
  }
  if (res.status === 401 || res.status === 403) {
    if (!retried) {
      await bootstrapSession(true);
      return graphqlPost(shortcode, true);
    }
    throw new Error("Instagram asked for a login wall. Public posts usually still work — try again.");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Instagram returned an unexpected response.");
  }
  const root = asRecord(json);
  // A rejected doc_id must be named before any of the branches below, which all
  // read as "that post is gone" and would send the reader to the wrong problem.
  assertDocIdAccepted(root);
  const data = asRecord(root?.data);
  const info = asRecord(data?.xdt_api__v1__media__shortcode__web_info);
  const items = asArray(info?.items);
  const first = asRecord(items[0]);
  if (!first) {
    const message = str(asRecord(root)?.message);
    if (message.toLowerCase().includes("login") && !retried) {
      await bootstrapSession(true);
      return graphqlPost(shortcode, true);
    }
    throw new Error("Could not find that post. It may be private, deleted, or age-gated.");
  }
  const post = mapPost(first);
  if (post.items.length === 0) {
    throw new Error("That post has no downloadable media.");
  }
  return post;
}

function emptyFeed(): ProfileFeed {
  return { items: [], cursor: null, hasMore: false };
}

function mergeFeeds(first: ProfileFeed, extra: ProfileFeed): ProfileFeed {
  const seen = new Set(first.items.map((p) => p.shortcode));
  const items = [...first.items];
  for (const post of extra.items) {
    if (!post.shortcode || seen.has(post.shortcode)) continue;
    seen.add(post.shortcode);
    items.push(post);
  }
  return {
    items,
    cursor: extra.cursor ?? first.cursor,
    hasMore: extra.hasMore,
  };
}

async function graphqlJson(docId: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  await bootstrapSession();
  const body = new URLSearchParams({
    variables: JSON.stringify(variables),
    doc_id: docId,
    server_timestamps: "true",
  });
  const res = await fetch("https://www.instagram.com/graphql/query", {
    method: "POST",
    headers: igHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  storeCookies(res);
  const text = await res.text();
  if (res.status === 429) {
    throw new Error("Instagram is rate-limiting this network. Wait a moment and try again.");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Instagram returned an unexpected response.");
  }
  const root = asRecord(json);
  if (!root) throw new Error("Instagram returned an unexpected response.");
  // Ahead of every caller's own error mapping: fetchTimelinePage in particular
  // turns a "bad request" summary into "no such profile", which would hide a
  // stale id behind a confident, wrong answer.
  assertDocIdAccepted(root);
  return root;
}

async function fetchTimelinePage(username: string, cursor?: string | null): Promise<ProfileFeed & { user: Record<string, unknown> | null }> {
  const variables: Record<string, unknown> = {
    data: {
      count: 36,
      include_relationship_info: true,
      latest_besties_reel_media: true,
      latest_reel_media: true,
    },
    username,
    __relay_internal__pv__PolarisFeedShareMenurelayprovider: false,
  };
  if (cursor) variables.after = cursor;
  const root = await graphqlJson((await getDocIds()).timeline, variables);
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
    if (post.items.length > 0 && post.shortcode) items.push(post);
  }
  return {
    items,
    cursor: str(page?.end_cursor) || null,
    hasMore: Boolean(page?.has_next_page),
    user,
  };
}

async function fetchReelsPage(userId: string, cursor?: string | null): Promise<ProfileFeed> {
  await bootstrapSession();
  const params: Record<string, string> = {
    target_user_id: userId,
    page_size: "12",
    include_feed_video: "true",
  };
  if (cursor) params.max_id = cursor;
  const res = await fetch("https://www.instagram.com/api/v1/clips/user/", {
    method: "POST",
    headers: igHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams(params),
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  storeCookies(res);
  const text = await res.text();
  if (!res.ok) return emptyFeed();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return emptyFeed();
  }
  const root = asRecord(json);
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
  };
}

async function fetchReelsMedia(reelIds: string[]): Promise<Record<string, unknown>[]> {
  if (reelIds.length === 0) return [];
  await bootstrapSession();
  const qs = reelIds.map((id) => encodeURIComponent(id)).join(",");
  const res = await fetch(`https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${qs}`, {
    headers: igHeaders({ Accept: "application/json" }),
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  });
  storeCookies(res);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const root = asRecord(json);
  const reels = asRecord(root?.reels) ?? {};
  const listed = asArray(root?.reels_media);
  if (listed.length > 0) return listed.map((entry) => asRecord(entry)).filter((v): v is Record<string, unknown> => Boolean(v));
  return Object.values(reels)
    .map((entry) => asRecord(entry))
    .filter((v): v is Record<string, unknown> => Boolean(v));
}

function postsFromReels(reels: Record<string, unknown>[], kind: "story" | "highlight"): PostResult[] {
  const items: PostResult[] = [];
  for (const reel of reels) {
    const title = str(reel.title);
    for (const entry of asArray(reel.items)) {
      const rec = asRecord(entry);
      if (!rec) continue;
      rec.product_type = kind === "highlight" ? "story_highlight" : rec.product_type || "story";
      if (title) rec.title = title;
      const post = mapPost(rec);
      if (post.items.length === 0) continue;
      items.push({
        ...post,
        kind,
        highlightTitle: kind === "highlight" ? title || post.highlightTitle : post.highlightTitle,
      });
    }
  }
  return items;
}

async function fetchStories(userId: string): Promise<ProfileFeed> {
  try {
    const reels = await fetchReelsMedia([userId]);
    return { items: postsFromReels(reels, "story"), cursor: null, hasMore: false };
  } catch {
    return emptyFeed();
  }
}

async function fetchHighlightTray(userId: string): Promise<{ hasPublicStory: boolean; highlights: { id: string; title: string }[] }> {
  try {
    const root = await graphqlJson((await getDocIds()).highlightsTray, {
      user_id: userId,
      include_chaining: false,
      include_reel: true,
      include_suggested_users: false,
      include_logged_out_extras: true,
      include_highlight_reels: true,
      include_live_status: true,
    });
    const user = asRecord(asRecord(root.data)?.user);
    const edges = asArray(asRecord(user?.edge_highlight_reels)?.edges);
    const highlights: { id: string; title: string }[] = [];
    for (const edge of edges) {
      const node = asRecord(asRecord(edge)?.node);
      if (!node) continue;
      const id = str(node.id).replace(/^highlight:/, "");
      if (!id) continue;
      highlights.push({ id, title: str(node.title) || "Highlight" });
    }
    return { hasPublicStory: Boolean(user?.has_public_story), highlights };
  } catch (error) {
    // Highlights are best-effort and a failure here must not sink a profile
    // load — but a stale id is a configuration problem the user can act on, so
    // it propagates. fetchProfile still swallows it; fetchProfileTab reports it.
    if (error instanceof StaleDocIdError) throw error;
    return { hasPublicStory: false, highlights: [] };
  }
}

async function fetchHighlights(userId: string): Promise<{ feed: ProfileFeed; hasPublicStory: boolean }> {
  const tray = await fetchHighlightTray(userId);
  if (tray.highlights.length === 0) {
    return { feed: emptyFeed(), hasPublicStory: tray.hasPublicStory };
  }
  const reelIds = tray.highlights.slice(0, 24).map((h) => `highlight:${h.id}`);
  const chunks: string[][] = [];
  for (let i = 0; i < reelIds.length; i += 8) chunks.push(reelIds.slice(i, i + 8));
  const reels: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    reels.push(...(await fetchReelsMedia(chunk)));
  }
  const titleById = new Map(tray.highlights.map((h) => [`highlight:${h.id}`, h.title]));
  for (const reel of reels) {
    const id = str(reel.id) || str(reel.strong_id__);
    const titled = titleById.get(id);
    if (titled && !str(reel.title)) reel.title = titled;
  }
  return {
    feed: { items: postsFromReels(reels, "highlight"), cursor: null, hasMore: false },
    hasPublicStory: tray.hasPublicStory,
  };
}

function profileFromUser(
  username: string,
  user: Record<string, unknown> | null,
  posts: ProfileFeed,
  reels: ProfileFeed,
  stories: ProfileFeed,
  highlights: ProfileFeed,
  hasPublicStory: boolean,
): ProfileResult {
  const hdPic = asRecord(user?.hd_profile_pic_url_info);
  return {
    username: str(user?.username, username),
    fullName: str(user?.full_name),
    biography: str(user?.biography),
    profilePicUrl: str(hdPic?.url) || str(user?.profile_pic_url) || null,
    followers: num(user?.follower_count) || num(asRecord(user?.edge_followed_by)?.count),
    following: num(user?.following_count) || num(asRecord(user?.edge_follow)?.count),
    postCount: num(user?.media_count),
    isPrivate: Boolean(user?.is_private),
    isVerified: Boolean(user?.is_verified),
    userId: str(user?.pk) || str(user?.id) || null,
    hasPublicStory,
    posts,
    reels,
    stories,
    highlights,
  };
}

export async function fetchProfile(username: string): Promise<ProfileResult> {
  const timeline = await fetchTimelinePage(username);
  if (timeline.user && Boolean(timeline.user.is_private) && timeline.items.length === 0) {
    throw new Error(`@${username} is private. Keepsake only reads public media.`);
  }
  const userId = str(timeline.user?.pk) || str(timeline.user?.id);
  let posts: ProfileFeed = { items: timeline.items, cursor: timeline.cursor, hasMore: timeline.hasMore };
  if (!userId) {
    return profileFromUser(username, timeline.user, posts, emptyFeed(), emptyFeed(), emptyFeed(), false);
  }
  const [reels, stories, highlightPack, extraPosts] = await Promise.all([
    fetchReelsPage(userId).catch(() => emptyFeed()),
    fetchStories(userId).catch(() => emptyFeed()),
    fetchHighlights(userId).catch(() => ({ feed: emptyFeed(), hasPublicStory: false })),
    timeline.hasMore && timeline.cursor
      ? fetchTimelinePage(username, timeline.cursor).catch(() => emptyFeed())
      : Promise.resolve(emptyFeed()),
  ]);
  if (extraPosts.items.length > 0) {
    posts = mergeFeeds(posts, extraPosts);
  }
  return profileFromUser(
    username,
    timeline.user,
    posts,
    reels,
    stories,
    highlightPack.feed,
    highlightPack.hasPublicStory,
  );
}

export async function fetchProfileTab(
  username: string,
  tab: ProfileTab,
  cursor?: string | null,
  userId?: string | null,
): Promise<ProfileFeed> {
  if (tab === "posts") {
    const page = await fetchTimelinePage(username, cursor);
    return { items: page.items, cursor: page.cursor, hasMore: page.hasMore };
  }
  let id = userId || "";
  if (!id) {
    const lookup = await fetchTimelinePage(username);
    id = str(lookup.user?.pk) || str(lookup.user?.id);
  }
  if (!id) return emptyFeed();
  if (tab === "reels") return fetchReelsPage(id, cursor);
  if (tab === "stories") return fetchStories(id);
  return (await fetchHighlights(id)).feed;
}

export async function resolveInstagramQuery(query: string): Promise<ResolveResult> {
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
        const shortcode = item.kind === "share" ? await resolveShareUrl(item.href) : item.shortcode;
        results.push(await graphqlPost(shortcode));
      }
      return { ok: true, mode: "post", posts: results };
    }
    const profileQuery = profiles[0];
    if (!profileQuery || profileQuery.kind !== "profile") {
      return { ok: false, error: "Paste a username, profile link, or a public post / reel link." };
    }
    const profile = await fetchProfile(profileQuery.username);
    return { ok: true, mode: "profile", profile };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong talking to Instagram.";
    return { ok: false, error: message };
  }
}

export async function fetchRemoteMedia(url: string): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new Response("Invalid media URL", { status: 400 });
  }
  if (parsed.protocol !== "https:" || !isAllowedMediaHost(parsed.hostname)) {
    return new Response("Blocked host", { status: 400 });
  }
  const res = await fetch(parsed.toString(), {
    headers: {
      "User-Agent": UA,
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
