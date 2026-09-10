import type { PostResult, ProfileResult, ProfileTab } from "@/core/instagram/types";
import { fetchUrl } from "@/lib/media/source";
import { entriesFromPosts, fileName } from "./naming";
import { shareOrDownload, type SaveOutcome } from "./share";

const ZIP_LIMIT = 100;
const ZIP_BATCH = 6;
/** Per-file ceiling so one stalled CDN response cannot hang a whole archive. */
const MEDIA_TIMEOUT_MS = 45_000;

export type ZipEntry = { name: string; url: string };

export type ZipOutcome = {
  outcome: SaveOutcome;
  saved: number;
  failed: number;
};

/**
 * Fetch every entry through the media proxy and hand back one zip.
 *
 * Batched rather than all-at-once: a hundred parallel CDN fetches is both hard
 * on the device and the kind of traffic worth not generating.
 */
export async function zipMedia(entries: ZipEntry[], zipName: string): Promise<ZipOutcome> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const slice = entries.slice(0, ZIP_LIMIT);
  let saved = 0;
  let failed = 0;
  for (let i = 0; i < slice.length; i += ZIP_BATCH) {
    const batch = slice.slice(i, i + ZIP_BATCH);
    await Promise.all(
      batch.map(async (entry) => {
        // One expired or unreachable CDN URL must not abort the whole archive,
        // so every failure is counted and reported rather than thrown or, worse,
        // dropped silently into a zip the caller then calls a success.
        try {
          const res = await fetch(fetchUrl(entry.url), {
            signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
          });
          if (!res.ok) {
            failed += 1;
            return;
          }
          zip.file(entry.name, await res.blob());
          saved += 1;
        } catch {
          failed += 1;
        }
      }),
    );
  }
  if (saved === 0) {
    throw new Error("None of those files could be fetched.");
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const href = URL.createObjectURL(blob);
  try {
    return { outcome: await shareOrDownload(blob, zipName, href), saved, failed };
  } finally {
    // Revoked late: the share sheet or download may still be reading it.
    window.setTimeout(() => URL.revokeObjectURL(href), 15_000);
  }
}

export function downloadPostZip(post: PostResult): Promise<ZipOutcome> {
  return zipMedia(
    post.items.map((item, index) => ({
      name: fileName(post, index, item.kind, item.url),
      url: item.url,
    })),
    `${post.owner.username}_${post.shortcode}.zip`,
  );
}

export function downloadFeedZip(
  username: string,
  tab: ProfileTab,
  posts: PostResult[],
): Promise<ZipOutcome> {
  return zipMedia(entriesFromPosts(username, tab, posts), `${username}_${tab}.zip`);
}

/**
 * Per-tab caps for a whole-profile archive, so one enormous tab cannot crowd
 * the others out of the ZIP_LIMIT. Ordered by what a person is most likely to
 * be archiving urgently: stories expire, posts do not.
 */
const PROFILE_BUCKETS: { tab: ProfileTab; cap: number }[] = [
  { tab: "stories", cap: 24 },
  { tab: "highlights", cap: 40 },
  { tab: "posts", cap: 30 },
  { tab: "reels", cap: 24 },
];

export function profileZipEntries(profile: ProfileResult): ZipEntry[] {
  const username = profile.username;
  const entries: ZipEntry[] = [];
  if (profile.profilePicUrl) {
    entries.push({ name: `${username}/avatar.jpg`, url: profile.profilePicUrl });
  }
  for (const bucket of PROFILE_BUCKETS) {
    entries.push(
      ...entriesFromPosts(username, bucket.tab, profile[bucket.tab].items).slice(0, bucket.cap),
    );
  }
  return entries;
}

export function downloadProfileZip(profile: ProfileResult): Promise<ZipOutcome> {
  return zipMedia(profileZipEntries(profile), `${profile.username}_profile.zip`);
}
