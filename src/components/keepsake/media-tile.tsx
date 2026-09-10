import { Download, Film, Image as ImageIcon, LoaderCircle, Play } from "lucide-react";
import type { PostResult } from "@/core/instagram/types";
import { displayUrl } from "@/lib/media/source";
import { fileName } from "@/lib/download/naming";
import { saveHref } from "@/lib/download/share";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SaveLink } from "./save-link";

function kindLabel(kind: PostResult["kind"]): string {
  if (kind === "carousel") return "Carousel";
  if (kind === "reel") return "Reel";
  if (kind === "video") return "Video";
  if (kind === "story") return "Story";
  if (kind === "highlight") return "Highlight";
  return "Photo";
}

export function MediaTile({
  post,
  index,
  busyKey,
  onOpen,
  onDownloadAll,
}: {
  post: PostResult;
  index: number;
  busyKey: string | null;
  onOpen: (itemIndex: number) => void;
  onDownloadAll: () => void;
}) {
  const cover = post.items[0];
  const saving = busyKey === `${post.shortcode}-all`;
  const single = post.items[0];
  const singleName = single ? fileName(post, 0, single.kind, single.url) : "";
  return (
    <article className="overflow-hidden rounded-xl bg-bg-elevated shadow-[var(--shadow-border)]">
      <button
        type="button"
        onClick={() => onOpen(0)}
        className="group relative block aspect-[4/5] w-full overflow-hidden bg-bg-subtle"
      >
        {cover ? (
          <img
            src={displayUrl(cover.thumbnailUrl || cover.url)}
            alt={post.caption.slice(0, 80) || `Post ${post.shortcode}`}
            className="h-full w-full object-cover transition-transform duration-500 ease-[var(--ease-smooth-out)] group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-subtle">No preview</div>
        )}
        <span className="absolute left-3 top-3 font-mono text-[11px] tabular-nums text-fg/90">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="absolute right-3 top-3">
          <Badge className="bg-bg/70 backdrop-blur-sm">{kindLabel(post.kind)}</Badge>
        </span>
        {cover?.kind === "video" ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-bg/70 text-fg">
              <Play className="ml-0.5 size-5" fill="currentColor" />
            </span>
          </span>
        ) : null}
        {post.items.length > 1 ? (
          <span className="absolute bottom-3 right-3 flex items-center gap-1 text-xs text-fg">
            <Film className="size-3.5" />
            {post.items.length}
          </span>
        ) : null}
      </button>
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-medium">
            @{post.owner.username || "unknown"}
            {post.highlightTitle ? ` · ${post.highlightTitle}` : ""}
          </p>
          <p className="shrink-0 text-xs text-subtle">{formatDate(post.takenAt)}</p>
        </div>
        {post.caption ? (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{post.caption}</p>
        ) : post.kind === "story" || post.kind === "highlight" ? null : (
          <p className="mt-2 text-sm text-subtle">No caption</p>
        )}
        <div className="mt-4 flex gap-2">
          {/* A single file is a direct link, so the browser's own save works.
              Only a multi-file post needs zipping, and therefore a handler. */}
          {post.items.length <= 1 && single ? (
            <SaveLink href={saveHref(single.url, singleName)} name={singleName} className="flex-1">
              <Download className="size-4" />
              Save
            </SaveLink>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={onDownloadAll}
              disabled={saving || post.items.length === 0}
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              Save all
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(0)}>
            <ImageIcon className="size-4" />
            View
          </Button>
        </div>
        {post.items.length > 1 ? (
          <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {post.items.map((item, itemIndex) => {
              const name = fileName(post, itemIndex, item.kind, item.url);
              return (
                <a
                  key={item.id}
                  href={saveHref(item.url, name)}
                  download={name}
                  target="_blank"
                  rel="noopener"
                  className="relative size-14 shrink-0 overflow-hidden rounded-sm bg-bg-subtle"
                  aria-label={`Save slide ${itemIndex + 1}`}
                >
                  <img
                    src={displayUrl(item.thumbnailUrl || item.url)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {item.kind === "video" ? (
                    <Play className="absolute inset-0 m-auto size-3.5 text-fg" fill="currentColor" />
                  ) : null}
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}
