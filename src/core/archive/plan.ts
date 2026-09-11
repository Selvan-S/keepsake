import type { ProfileResult, ProfileTab } from "../instagram/types.ts";
import { archivePath } from "./naming.ts";

/**
 * Turning "archive this profile" into an ordered list of files to fetch.
 *
 * Pure: it reads a ProfileResult that is already in memory and produces names
 * and URLs. Deciding *what* to archive is separate from doing it, so the plan
 * can be counted, shown to the user, and tested without a network.
 */

export type ArchiveEntry = {
  name: string;
  url: string;
  /** Which post this file came from, so a resumed job can skip it. */
  shortcode: string;
  tab: ProfileTab;
};

export type ArchiveScope = {
  tabs: ProfileTab[];
  /** Posts per tab, or null for everything available. */
  perTabLimit: number | null;
  /**
   * When set, only these posts are archived — the selection path. Selected
   * posts are already in memory, so a job scoped this way skips collection
   * entirely.
   */
  only?: ReadonlySet<string>;
};

/**
 * Fixed archive order, most-perishable first.
 *
 * Stories expire in 24 hours and highlights can be deleted at any time; posts
 * and reels are comparatively durable. If a run is interrupted, this ordering
 * means what was lost is the recoverable part.
 */
const TAB_ORDER: ProfileTab[] = ["stories", "highlights", "posts", "reels"];

export function orderedTabs(tabs: readonly ProfileTab[]): ProfileTab[] {
  const wanted = new Set(tabs);
  return TAB_ORDER.filter((tab) => wanted.has(tab));
}

export type PlanOptions = {
  /** Shortcodes a previous run already saved; skipped without being counted. */
  alreadySaved?: ReadonlySet<string>;
};

/**
 * The files an archive should contain, in the order they should be fetched.
 *
 * One post can contribute several files (a carousel), so the entry count is
 * always at least the post count and usually more — which is why estimates are
 * shown in files, not posts.
 */
export function planEntries(
  profile: ProfileResult,
  scope: ArchiveScope,
  options: PlanOptions = {},
): ArchiveEntry[] {
  const { alreadySaved } = options;
  const entries: ArchiveEntry[] = [];

  for (const tab of orderedTabs(scope.tabs)) {
    let posts = profile[tab].items;
    if (scope.only) posts = posts.filter((post) => scope.only!.has(post.shortcode));
    if (alreadySaved) posts = posts.filter((post) => !alreadySaved.has(post.shortcode));
    if (scope.perTabLimit !== null) posts = posts.slice(0, scope.perTabLimit);

    for (const post of posts) {
      post.items.forEach((item, index) => {
        entries.push({
          name: archivePath(profile.username, tab, post, index, item.kind, item.url),
          url: item.url,
          shortcode: post.shortcode,
          tab,
        });
      });
    }
  }
  return entries;
}

/** The avatar, as its own entry. Kept separate: it is not a post and has no shortcode. */
export function avatarEntry(profile: ProfileResult): ArchiveEntry | null {
  if (!profile.profilePicUrl) return null;
  return {
    name: `${profile.username}/avatar.jpg`,
    url: profile.profilePicUrl,
    shortcode: `__avatar__${profile.username}`,
    tab: "posts",
  };
}

/**
 * How many posts a tab still needs fetched before the plan can be built.
 *
 * `null` means "everything", and we cannot know the total until Instagram stops
 * handing out cursors — so a caller pages until `hasMore` is false rather than
 * toward a number.
 */
export function postsStillNeeded(
  loaded: number,
  hasMore: boolean,
  perTabLimit: number | null,
): number | null {
  if (!hasMore) return 0;
  if (perTabLimit === null) return null;
  return Math.max(0, perTabLimit - loaded);
}
