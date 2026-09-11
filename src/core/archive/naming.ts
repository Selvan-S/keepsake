import type { PostResult, ProfileTab } from "../instagram/types.ts";

/**
 * Archive file naming. Pure and platform-free: the names are part of what the
 * user keeps, so they are worth testing directly rather than only observing
 * through a downloaded zip.
 */

export function extFor(kind: "image" | "video", url: string): string {
  const lower = url.toLowerCase();
  if (kind === "video") return "mp4";
  if (lower.includes(".png")) return "png";
  if (lower.includes(".webp")) return "webp";
  return "jpg";
}

/**
 * Make one path segment safe for a zip entry on any filesystem. Captions and
 * highlight titles are arbitrary user text, including emoji and slashes.
 */
export function safeSegment(value: string): string {
  return value.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "item";
}

/**
 * A single file's name: who, when, which post, and which slide of it. Dated
 * first so a folder sorts chronologically.
 */
export function fileName(
  post: PostResult,
  index: number,
  kind: "image" | "video",
  url: string,
): string {
  const date = post.takenAt ? new Date(post.takenAt * 1000).toISOString().slice(0, 10) : "undated";
  const suffix = post.items.length > 1 ? `_${String(index + 1).padStart(2, "0")}` : "";
  const prefix = post.highlightTitle
    ? `${safeSegment(post.owner.username)}_${safeSegment(post.highlightTitle)}`
    : post.owner.username || "ig";
  return `${prefix}_${date}_${post.shortcode}${suffix}.${extFor(kind, url)}`.replace(/\s+/g, "_");
}

/** Where that file sits inside a profile archive. */
export function archivePath(
  username: string,
  tab: ProfileTab,
  post: PostResult,
  index: number,
  kind: "image" | "video",
  url: string,
): string {
  const name = fileName(post, index, kind, url);
  // Highlights get a folder per album, since that is how the user thinks of
  // them and a flat dump of 200 files does not.
  if (tab === "highlights" && post.highlightTitle) {
    return `${username}/highlights/${safeSegment(post.highlightTitle)}/${name}`;
  }
  return `${username}/${tab}/${name}`;
}

export function entriesFromPosts(
  username: string,
  tab: ProfileTab,
  posts: PostResult[],
): { name: string; url: string }[] {
  return posts.flatMap((post) =>
    post.items.map((item, index) => ({
      name: archivePath(username, tab, post, index, item.kind, item.url),
      url: item.url,
    })),
  );
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
