import { BadgeCheck, UserRound } from "lucide-react";
import type { ProfileResult, ProfileTab } from "@/core/instagram/types";
import { proxiedMediaUrl } from "@/lib/instagram/media-url";
import { formatCount } from "@/lib/format";
import { DownloadBar } from "./download-bar";
import { TabBar } from "./tab-bar";

export function ProfileHeader({
  profile,
  tab,
  onTab,
  onSaveTab,
  onSaveProfile,
  savingTab,
  savingProfile,
  fillNote,
  archiveCount,
}: {
  profile: ProfileResult;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  onSaveTab: () => void;
  onSaveProfile: () => void;
  savingTab: boolean;
  savingProfile: boolean;
  fillNote: string | null;
  archiveCount: number;
}) {
  const feed = profile[tab];
  // Counts are frequently absent from logged-out responses, so each stat is
  // dropped rather than printed as a zero the user would read as fact.
  const stats = [
    archiveCount
      ? `${archiveCount}${feed.hasMore || profile.posts.hasMore || profile.reels.hasMore ? "+" : ""} saved`
      : null,
    profile.followers ? `${formatCount(profile.followers)} followers` : null,
    profile.postCount ? `${formatCount(profile.postCount)} posts` : null,
  ].filter(Boolean);

  return (
    <div className="mb-6 rounded-xl bg-bg-elevated p-4 shadow-[var(--shadow-border)] sm:p-5">
      <div className="flex items-start gap-4">
        {profile.profilePicUrl ? (
          <img
            src={proxiedMediaUrl(profile.profilePicUrl)}
            alt=""
            className="size-16 rounded-full object-cover sm:size-[4.5rem]"
          />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-full bg-bg-subtle sm:size-[4.5rem]">
            <UserRound className="size-6 text-muted" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="font-display text-2xl tracking-[-0.03em]">@{profile.username}</h2>
            {profile.isVerified ? <BadgeCheck className="size-4 text-muted" aria-label="Verified" /> : null}
            {profile.fullName ? <span className="text-sm text-muted">{profile.fullName}</span> : null}
          </div>
          {stats.length > 0 ? (
            <p className="mt-2 text-sm tabular-nums text-muted">{stats.join(" · ")}</p>
          ) : null}
          {profile.biography ? (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{profile.biography}</p>
          ) : null}
          {fillNote ? <p className="mt-2 text-xs text-subtle">{fillNote}</p> : null}
        </div>
      </div>

      <TabBar profile={profile} tab={tab} onTab={onTab} />
      <DownloadBar
        profile={profile}
        tab={tab}
        onSaveTab={onSaveTab}
        onSaveProfile={onSaveProfile}
        savingTab={savingTab}
        savingProfile={savingProfile}
        archiveCount={archiveCount}
      />
    </div>
  );
}
