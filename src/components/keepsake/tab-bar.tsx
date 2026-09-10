import { Bookmark, CircleDot, Clapperboard, Grid2x2 } from "lucide-react";
import type { ProfileResult, ProfileTab } from "@/core/instagram/types";
import { cn } from "@/lib/utils";

const TABS: { id: ProfileTab; label: string; icon: typeof Grid2x2 }[] = [
  { id: "posts", label: "Posts", icon: Grid2x2 },
  { id: "reels", label: "Reels", icon: Clapperboard },
  { id: "stories", label: "Stories", icon: CircleDot },
  { id: "highlights", label: "Highlights", icon: Bookmark },
];

export function TabBar({
  profile,
  tab,
  onTab,
}: {
  profile: ProfileResult;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {TABS.map((item) => {
        const Icon = item.icon;
        const feed = profile[item.id];
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm transition-[color,box-shadow] duration-150",
              active
                ? "bg-primary text-primary-fg"
                : "text-muted shadow-[var(--shadow-border)] hover:text-fg hover:shadow-[var(--shadow-border-hover)]",
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
            {/* A count is only meaningful once the tab has been fetched; an
                unloaded tab shows nothing rather than a misleading zero. */}
            {feed.loaded && feed.items.length > 0 ? (
              <span className="tabular-nums text-xs opacity-70">{feed.items.length}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
