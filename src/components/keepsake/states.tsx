import type { ProfileTab } from "@/core/instagram/types";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingState() {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="overflow-hidden rounded-xl bg-bg-elevated shadow-[var(--shadow-border)]">
          <Skeleton className="aspect-[4/5] w-full rounded-none" />
          <div className="space-y-3 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Shown only once a tab has actually been fetched. An unloaded tab must never
 * reach this: "no stories" and "not asked for yet" are different claims, and
 * only one of them is true before the request happens.
 */
export function EmptyTab({
  tab,
  username,
  hasPublicStory,
}: {
  tab: ProfileTab;
  username: string;
  hasPublicStory: boolean;
}) {
  const copy =
    tab === "stories"
      ? hasPublicStory
        ? `@${username} has a story up, but Instagram did not send the frames to a logged-out archive.`
        : `Instagram hides live stories from logged-out tools. If @${username} has a story up, open it in the app.`
      : tab === "highlights"
        ? `No public highlights came back for @${username}.`
        : tab === "reels"
          ? `No public reels came back for @${username}.`
          : `No public posts came back for @${username}.`;
  return (
    <div className="rounded-xl bg-bg-elevated px-5 py-6 shadow-[var(--shadow-border)]">
      <p className="font-display text-2xl tracking-[-0.03em]">Nothing in {tab}</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{copy}</p>
    </div>
  );
}

export function ResolveError({ error }: { error: string }) {
  return (
    <div className="rounded-xl bg-bg-elevated px-5 py-6 shadow-[var(--shadow-border)]">
      <p className="font-display text-2xl tracking-[-0.03em]">Nothing came back</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{error}</p>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-subtle">
        Use a public username like @nasa, or a post / reel link from Share → Copy link.
      </p>
    </div>
  );
}
