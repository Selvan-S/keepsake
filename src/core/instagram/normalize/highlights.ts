import type { PostResult } from "../types.ts";
import { asArray, asRecord, str } from "./json.ts";
import { mapPost } from "./post.ts";

export type HighlightRef = { id: string; title: string };

/** Read the highlights tray: the list of albums, not their contents. */
export function highlightTrayFromJson(root: Record<string, unknown>): {
  hasPublicStory: boolean;
  highlights: HighlightRef[];
} {
  const user = asRecord(asRecord(root.data)?.user);
  const edges = asArray(asRecord(user?.edge_highlight_reels)?.edges);
  const highlights: HighlightRef[] = [];
  for (const edge of edges) {
    const node = asRecord(asRecord(edge)?.node);
    if (!node) continue;
    const id = str(node.id).replace(/^highlight:/, "");
    if (!id) continue;
    highlights.push({ id, title: str(node.title) || "Highlight" });
  }
  return { hasPublicStory: Boolean(user?.has_public_story), highlights };
}

/** Read a reels_media response, which returns reels either listed or keyed. */
export function reelsMediaFromJson(root: Record<string, unknown> | null): Record<string, unknown>[] {
  const listed = asArray(root?.reels_media);
  if (listed.length > 0) {
    return listed.map(asRecord).filter((v): v is Record<string, unknown> => Boolean(v));
  }
  const reels = asRecord(root?.reels) ?? {};
  return Object.values(reels)
    .map(asRecord)
    .filter((v): v is Record<string, unknown> => Boolean(v));
}

/**
 * Flatten reels into posts. The album title lives on the reel, not on its
 * items, so it is pushed down onto each item as it is mapped.
 */
export function postsFromReels(
  reels: Record<string, unknown>[],
  kind: "story" | "highlight",
): PostResult[] {
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

/** Attach tray titles to reels that came back without one. */
export function applyHighlightTitles(
  reels: Record<string, unknown>[],
  highlights: HighlightRef[],
): void {
  const titleById = new Map(highlights.map((h) => [`highlight:${h.id}`, h.title]));
  for (const reel of reels) {
    const id = str(reel.id) || str(reel.strong_id__);
    const titled = titleById.get(id);
    if (titled && !str(reel.title)) reel.title = titled;
  }
}
