import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { PostResult, ProfileTab } from "@/core/instagram/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MediaTile } from "./media-tile";

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-10 shrink-0 rounded-full px-3 text-sm transition-[color,box-shadow] duration-150",
        active
          ? "bg-primary text-primary-fg"
          : "text-muted shadow-[var(--shadow-border)] hover:text-fg hover:shadow-[var(--shadow-border-hover)]",
      )}
    >
      {children}
    </button>
  );
}

/** The album chips above the highlights tab. */
export function HighlightFilter({
  albums,
  active,
  total,
  counts,
  onSelect,
}: {
  albums: string[];
  active: string;
  total: number;
  counts: Map<string, number>;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
      <FilterChip active={active === "all"} onClick={() => onSelect("all")}>
        All {total}
      </FilterChip>
      {albums.map((title) => (
        <FilterChip key={title} active={active === title} onClick={() => onSelect(title)}>
          {title} {counts.get(title) ?? 0}
        </FilterChip>
      ))}
    </div>
  );
}

export function MediaGrid({
  posts,
  wide,
  busyKey,
  onOpen,
  onDownloadPost,
}: {
  posts: PostResult[];
  wide: boolean;
  busyKey: string | null;
  onOpen: (post: PostResult, itemIndex: number) => void;
  onDownloadPost: (post: PostResult) => void;
}) {
  return (
    <div className={cn("grid gap-5", wide ? "sm:grid-cols-2" : "max-w-lg")}>
      {posts.map((post, i) => (
        <MediaTile
          key={`${post.kind}-${post.shortcode}-${i}`}
          post={post}
          index={i}
          busyKey={busyKey}
          onOpen={(itemIndex) => onOpen(post, itemIndex)}
          onDownloadAll={() => onDownloadPost(post)}
        />
      ))}
    </div>
  );
}

export function TabLoading({ tab }: { tab: ProfileTab }) {
  return (
    <div className="mt-8 flex justify-center text-sm text-subtle">
      <LoaderCircle className="mr-2 size-4 animate-spin" />
      Loading {tab}…
    </div>
  );
}

export function LoadMoreBar({
  loading,
  onLoadMore,
  onLoadRest,
}: {
  loading: boolean;
  onLoadMore: () => void;
  onLoadRest: () => void;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Button type="button" variant="secondary" size="lg" onClick={onLoadMore} disabled={loading}>
        {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {loading ? "Loading" : "Load more"}
      </Button>
      <Button type="button" variant="ghost" size="lg" onClick={onLoadRest} disabled={loading}>
        Load the rest
      </Button>
    </div>
  );
}
