import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import type { PostResult } from "@/core/instagram/types";
import { displayUrl } from "@/lib/media/source";
import { fileName } from "@/lib/download/naming";
import { saveHref } from "@/lib/download/share";
import { Button } from "@/components/ui/button";
import { SaveLink } from "./save-link";

export function Lightbox({
  post,
  index,
  onClose,
  onIndex,
}: {
  post: PostResult;
  index: number;
  onClose: () => void;
  onIndex: (next: number) => void;
}) {
  const item = post.items[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && post.items.length > 1) {
        onIndex((index - 1 + post.items.length) % post.items.length);
      }
      if (event.key === "ArrowRight" && post.items.length > 1) {
        onIndex((index + 1) % post.items.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, onIndex, post.items.length]);

  if (!item) return null;
  const name = fileName(post, index, item.kind, item.url);
  const prev = () => onIndex((index - 1 + post.items.length) % post.items.length);
  const next = () => onIndex((index + 1) % post.items.length);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg/95"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      onClick={onClose}
    >
      {/* The backdrop closes on click, so every interactive region inside has
          to stop propagation or the viewer shuts under the user's finger. */}
      <div className="flex items-center justify-between px-4 py-3 sm:px-6" onClick={(e) => e.stopPropagation()}>
        <p className="truncate text-sm text-muted">
          @{post.owner.username}
          {post.highlightTitle ? ` · ${post.highlightTitle}` : ""} · {index + 1}/{post.items.length}
        </p>
        <div className="flex items-center gap-2">
          <SaveLink href={saveHref(item.url, name)} name={name}>
            <Download className="size-4" />
            Save
          </SaveLink>
          <Button type="button" variant="secondary" size="icon" className="size-9" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-8">
        {post.items.length > 1 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="absolute left-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-bg-elevated text-fg shadow-[var(--shadow-border)]"
            aria-label="Previous"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : null}
        {item.kind === "video" ? (
          <video
            key={item.url}
            src={displayUrl(item.url)}
            poster={displayUrl(item.thumbnailUrl)}
            className="max-h-full max-w-full rounded-lg object-contain"
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            src={displayUrl(item.url)}
            alt={post.caption.slice(0, 120)}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {post.items.length > 1 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="absolute right-3 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-bg-elevated text-fg shadow-[var(--shadow-border)]"
            aria-label="Next"
          >
            <ChevronRight className="size-5" />
          </button>
        ) : null}
      </div>
      <p className="px-4 pb-6 text-center text-xs text-subtle">
        {item.kind === "image"
          ? "On a phone: press and hold the image to save it to Photos."
          : "Tap Save. If the file opens instead, use the browser share sheet."}
      </p>
    </div>
  );
}
