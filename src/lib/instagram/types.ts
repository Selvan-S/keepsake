export type MediaKind = "image" | "video";

export type MediaItem = {
  id: string;
  kind: MediaKind;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
};

export type PostOwner = {
  username: string;
  fullName: string;
  profilePicUrl: string | null;
};

export type PostKind = "image" | "video" | "carousel" | "reel" | "story" | "highlight";

export type PostResult = {
  shortcode: string;
  url: string;
  kind: PostKind;
  takenAt: number | null;
  caption: string;
  likeCount: number;
  commentCount: number;
  owner: PostOwner;
  items: MediaItem[];
  complete: boolean;
  highlightTitle?: string;
};

export type ProfileTab = "posts" | "reels" | "stories" | "highlights";

export type ProfileFeed = {
  items: PostResult[];
  cursor: string | null;
  hasMore: boolean;
};

export type ProfileResult = {
  username: string;
  fullName: string;
  biography: string;
  profilePicUrl: string | null;
  followers: number;
  following: number;
  postCount: number;
  isPrivate: boolean;
  isVerified: boolean;
  userId: string | null;
  hasPublicStory: boolean;
  posts: ProfileFeed;
  reels: ProfileFeed;
  stories: ProfileFeed;
  highlights: ProfileFeed;
};

export type ResolveOk =
  | { ok: true; mode: "post"; posts: PostResult[] }
  | { ok: true; mode: "profile"; profile: ProfileResult };

export type ResolveResult = ResolveOk | { ok: false; error: string };

export type ProfileMoreResult =
  | { ok: true; tab: ProfileTab; items: PostResult[]; cursor: string | null; hasMore: boolean }
  | { ok: false; error: string };
