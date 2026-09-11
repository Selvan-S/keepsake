import type { MediaItem } from "../types.ts";
import { asArray, asRecord, num, str } from "./json.ts";

/**
 * Instagram serves a thumbnail by encoding the size into the filename. Dropping
 * that segment asks for the original instead.
 */
export function upgradeImageUrl(url: string): string {
  return url.replace(/_s\d+x\d+/g, "");
}

/** The largest of Instagram's candidate renditions, by pixel area. */
export function pickBest(versions: unknown): { url: string; width: number; height: number } | null {
  let best: { url: string; width: number; height: number } | null = null;
  let area = -1;
  for (const entry of asArray(versions)) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const url = str(rec.url);
    if (!url) continue;
    const width = num(rec.width);
    const height = num(rec.height);
    // Unsized entries still beat nothing, so score them 1 rather than 0.
    const score = width * height || 1;
    if (score > area) {
      area = score;
      best = { url, width: width || 0, height: height || 0 };
    }
  }
  return best;
}

/**
 * The downloadable media on one node. A video node also carries images (its
 * poster frames), so video wins and the image becomes the thumbnail.
 */
export function mediaFromNode(node: Record<string, unknown>, id: string): MediaItem[] {
  const videos = pickBest(node.video_versions);
  const images = pickBest(asRecord(node.image_versions2)?.candidates);
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
