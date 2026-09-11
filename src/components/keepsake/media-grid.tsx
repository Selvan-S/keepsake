import type { ReactNode } from "react";
import { Download, LoaderCircle } from "lucide-react";
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
  selecting,
  selected,
  onToggleSelect,
}: {
  posts: PostResult[];
  wide: boolean;
  busyKey: string | null;
  onOpen: (post: PostResult, itemIndex: number) => void;
  onDownloadPost: (post: PostResult) => void;
  selecting: boolean;
  selected: ReadonlySet<string>;
  onToggleSelect: (post: PostResult) => void;
}) {
  return (
    <div className={cn("grid gap-5", wide ? "sm:grid-cols-2" : "max-w-lg")}>
      {posts.map((post, i) => (
        <MediaTile
          key={`${post.kind}-${post.shortcode}-${i}`}
          post={post}
          index={i}
          busyKey={busyKey}
          onOpen={onOpen}
          onDownloadAll={onDownloadPost}
          selecting={selecting}
          selected={selected.has(post.shortcode)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}

/**
 * How many tiles are rendered at once.
 *
 * Separate from how many posts are loaded: a fully archived profile holds
 * hundreds, and putting them all in the DOM is what made the page hang. This
 * caps the rendering, not the archive.
 */
export const GRID_PAGE = 48;

export function ShowMore({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  if (shown >= total) return null;
  return (
    <div className="mt-6 flex justify-center">
      <Button type="button" variant="secondary" onClick={onMore}>
        Show more ({shown} of {total})
      </Button>
    </div>
  );
}

export function SelectionBar({
  count,
  total,
  onSelectAll,
  onClear,
  onSave,
  onExit,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onSave: () => void;
  onExit: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-30 mx-auto mt-6 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-full bg-bg-elevated px-3 py-2 shadow-[var(--shadow-border-hover)]">
      <span className="px-1 text-sm tabular-nums text-muted">
        {count} selected
      </span>
      <Button type="button" variant="secondary" size="sm" onClick={count >= total ? onClear : onSelectAll}>
        {count >= total ? "Clear" : `All ${total}`}
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={count === 0}>
        <Download className="size-4" />
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onExit}>
        Done
      </Button>
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
