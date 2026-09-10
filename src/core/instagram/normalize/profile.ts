import type { ProfileFeed, ProfileResult } from "../types.ts";
import { asRecord, num, str } from "./json.ts";

/**
 * Build a ProfileResult from a user node and its feeds.
 *
 * Counts are read from both the mobile shape (`follower_count`) and the web
 * shape (`edge_followed_by.count`) because which one arrives depends on the
 * endpoint. Logged-out requests often carry neither, hence the zeroes the UI
 * hides rather than displays.
 */
export function profileFromUser(
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
