import type { MediaItem, PostKind, PostResult } from "../types.ts";
import { asArray, asRecord, num, str } from "./json.ts";
import { mediaFromNode } from "./media.ts";

/**
 * `product_type` is more specific than `media_type` and takes precedence: a
 * reel is media_type 2 (video) but should not be filed as a plain video.
 */
export function kindFromItem(item: Record<string, unknown>): PostKind {
  const mediaType = num(item.media_type);
  const product = str(item.product_type);
  if (product === "story") return "story";
  if (product === "highlights" || product === "story_highlight") return "highlight";
  if (product === "clips" || product === "igtv") return "reel";
  if (mediaType === 8) return "carousel";
  if (mediaType === 2) return "video";
  return "image";
}

/** One post node, from any endpoint, normalized to a PostResult. */
export function mapPost(item: Record<string, unknown>): PostResult {
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
