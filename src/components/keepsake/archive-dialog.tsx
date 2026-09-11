import { useEffect, useState } from "react";
import { Download, FolderOpen, LoaderCircle, X } from "lucide-react";
import type { ProfileResult, ProfileTab } from "@/core/instagram/types";
import { estimateBatchCount } from "@/core/archive/batch";
import type { ArchiveScope } from "@/core/archive/plan";
import { plural } from "@/core/archive/naming";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArchiveApi } from "@/hooks/use-archive";

const TAB_LABELS: Record<ProfileTab, string> = {
  posts: "Posts",
  reels: "Reels",
  stories: "Stories",
  highlights: "Highlights",
};

/** Warn before a run that will take a long time and a lot of requests. */
const LARGE_ARCHIVE = 1000;

/**
 * What each tab can contribute, and why not, when the answer is none.
 *
 * "No stories" and "stories need a login" are different facts, and showing them
 * identically is how a user concludes the app is broken.
 */
function tabAvailability(profile: ProfileResult, tab: ProfileTab, authenticated: boolean) {
  const feed = profile[tab];
  const needsLogin = tab === "stories" || tab === "highlights";
  if (feed.loaded && feed.items.length > 0) {
    const more = feed.hasMore ? "+" : "";
    return { enabled: true, note: `${feed.items.length}${more} loaded` };
  }
  if (!feed.loaded) {
    if (needsLogin && !authenticated) {
      return { enabled: true, note: "needs sign-in — will try anyway" };
    }
    return { enabled: true, note: "not fetched yet" };
  }
  if (needsLogin && !authenticated) {
    return { enabled: false, note: "needs sign-in" };
  }
  return { enabled: false, note: "none found" };
}

export function ArchiveDialog({
  profile,
  archive,
  authenticated,
  initialTabs,
  only,
  onClose,
}: {
  profile: ProfileResult;
  archive: ArchiveApi;
  authenticated: boolean;
  /** Narrower starting scope, e.g. "Save reels" on one tab. */
  initialTabs?: ProfileTab[];
  /** A specific set of posts. Collection and depth do not apply to these. */
  only?: ReadonlySet<string>;
  onClose: () => void;
}) {
  const [tabs, setTabs] = useState<ProfileTab[]>(
    initialTabs ?? ["posts", "reels", "highlights", "stories"],
  );
  const [everything, setEverything] = useState(true);
  const [limit, setLimit] = useState(120);
  const [confirmedLarge, setConfirmedLarge] = useState(false);
  const [toFolder, setToFolder] = useState(archive.folderModeAvailable);

  const { state } = archive;
  const running = state.status !== "idle";
  // Read straight through rather than memoised: the hook hands back a fresh
  // object every render, so a memo keyed on it would recompute anyway and only
  // suggest otherwise.
  const resume = archive.resumable();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  // A rough size for the warning: posts we know about, plus a guess for what
  // paging will find. Deliberately not presented as exact.
  const knownPosts = tabs.reduce((sum, tab) => sum + profile[tab].items.length, 0);
  const expectedPosts = everything
    ? Math.max(knownPosts, profile.postCount || knownPosts)
    : Math.min(limit * tabs.length, Math.max(knownPosts, profile.postCount || knownPosts));
  const isLarge = expectedPosts >= LARGE_ARCHIVE;

  const toggle = (tab: ProfileTab) =>
    setTabs((current) =>
      current.includes(tab) ? current.filter((t) => t !== tab) : [...current, tab],
    );

  // A selection is already in memory, so there is nothing to collect and no
  // depth to choose -- only a destination.
  const scope: ArchiveScope = only
    ? { tabs, perTabLimit: null, only }
    : { tabs, perTabLimit: everything ? null : limit };

  const begin = (resumePrevious: boolean) => {
    void archive.start(scope, { resume: resumePrevious, toFolder });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Archive profile"
      onClick={() => !running && onClose()}
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-bg-elevated p-5 shadow-[var(--shadow-border)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl tracking-[-0.03em]">
              {only
                ? `Save ${plural(only.size, "item")}`
                : initialTabs?.length === 1
                  ? `Save all ${initialTabs[0]}`
                  : `Archive @${profile.username}`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {running
                ? state.label
                : only
                  ? `From @${profile.username}.`
                  : "Choose what to include."}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-9 shrink-0"
            onClick={onClose}
            aria-label="Close"
            disabled={
              state.status === "collecting" ||
              state.status === "packaging" ||
              state.status === "writing"
            }
          >
            <X className="size-4" />
          </Button>
        </div>

        {!running ? (
          <>
            {resume ? (
              <div className="mt-4 rounded-lg bg-bg-subtle px-3 py-3 text-xs leading-relaxed text-muted">
                An earlier run saved {plural(resume.saved.length, "post")} from this profile.
                Resuming skips those. Media links expire, so a resume re-checks the feed rather
                than reusing old links.
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" onClick={() => begin(true)}>
                    Resume
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={archive.discardResume}>
                    Start over
                  </Button>
                </div>
              </div>
            ) : null}

            {!only && !initialTabs ? (
            <fieldset className="mt-4">
              <legend className="text-xs uppercase tracking-[0.16em] text-subtle">Include</legend>
              <div className="mt-2 grid gap-2">
                {(Object.keys(TAB_LABELS) as ProfileTab[]).map((tab) => {
                  const info = tabAvailability(profile, tab, authenticated);
                  const checked = tabs.includes(tab);
                  return (
                    <label
                      key={tab}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm shadow-[var(--shadow-border)]",
                        info.enabled ? "cursor-pointer" : "opacity-60",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-primary)]"
                        checked={checked && info.enabled}
                        disabled={!info.enabled}
                        onChange={() => toggle(tab)}
                      />
                      <span className="flex-1">{TAB_LABELS[tab]}</span>
                      <span className="text-xs text-subtle">{info.note}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            ) : null}

            {!only ? (
            <fieldset className="mt-4">
              <legend className="text-xs uppercase tracking-[0.16em] text-subtle">How much</legend>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={everything ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setEverything(true)}
                >
                  Everything
                </Button>
                <Button
                  type="button"
                  variant={!everything ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setEverything(false)}
                >
                  First
                </Button>
                {!everything ? (
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 w-24 rounded-lg bg-bg px-3 text-sm tabular-nums text-fg shadow-[var(--shadow-border)] outline-none"
                    aria-label="Posts per tab"
                  />
                ) : null}
                <span className="text-xs text-subtle">per tab</span>
              </div>
            </fieldset>
            ) : null}

            <fieldset className="mt-4">
              <legend className="text-xs uppercase tracking-[0.16em] text-subtle">Save as</legend>
              {archive.folderModeAvailable ? (
                <div className="mt-2 grid gap-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-sm shadow-[var(--shadow-border)]">
                    <input
                      type="radio"
                      className="mt-0.5 size-4 accent-[var(--color-primary)]"
                      checked={toFolder}
                      onChange={() => setToFolder(true)}
                    />
                    <span className="flex-1">
                      <span className="flex items-center gap-1.5">
                        <FolderOpen className="size-3.5" /> Folder on this device
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-subtle">
                        Pick a folder once and everything is written into
                        <span className="font-mono"> {profile.username}/posts/…</span> as it
                        downloads. Files already there are skipped, so running it again tops the
                        same folder up. No zips, and nothing held in memory.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-sm shadow-[var(--shadow-border)]">
                    <input
                      type="radio"
                      className="mt-0.5 size-4 accent-[var(--color-primary)]"
                      checked={!toFolder}
                      onChange={() => setToFolder(false)}
                    />
                    <span className="flex-1">
                      Zip files
                      <span className="mt-1 block text-xs leading-relaxed text-subtle">
                        Downloaded in batches, one tap each.
                      </span>
                    </span>
                  </label>
                </div>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-subtle">
                  Zip files, downloaded in batches with a tap each. Saving straight into a folder
                  needs the File System Access API, which this browser does not offer — it is
                  desktop Chrome and Edge only.
                </p>
              )}
            </fieldset>

            <p className="mt-4 text-xs leading-relaxed text-subtle">
              {only
                ? `${plural(only.size, "item")} selected, and carousels count as several files each. `
                : `Roughly ${expectedPosts.toLocaleString()} posts, and carousels count as several files each. `}
              {toFolder
                ? "Files are written as they arrive, so you can stop any time and re-run later to pick up the rest."
                : `That is at least ${estimateBatchCount(expectedPosts)} zip${estimateBatchCount(expectedPosts) === 1 ? "" : "s"}, saved one at a time — the browser will not accept them all at once.`}
            </p>

            {isLarge && !confirmedLarge && !only ? (
              <div className="mt-3 rounded-lg bg-bg-subtle px-3 py-3 text-xs leading-relaxed text-muted">
                That is a large archive. It will take a while and make a lot of requests. You can
                stop after any batch and resume later.
                <div className="mt-2">
                  <Button type="button" size="sm" onClick={() => setConfirmedLarge(true)}>
                    I understand, continue
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={() => begin(false)}
                disabled={tabs.length === 0 || (isLarge && !confirmedLarge && !only)}
              >
                <Download className="size-4" />
                {only ? "Save selected" : "Start archive"}
              </Button>
              <Button type="button" variant="secondary" size="lg" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <ArchiveProgress archive={archive} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function ArchiveProgress({ archive, onClose }: { archive: ArchiveApi; onClose: () => void }) {
  const { state } = archive;
  const busy =
    state.status === "collecting" || state.status === "packaging" || state.status === "writing";
  const pct = state.progress === null ? null : Math.round(state.progress * 100);

  return (
    <div className="mt-4">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-[width] duration-300",
            pct === null && "animate-pulse",
          )}
          style={{ width: pct === null ? "35%" : `${pct}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-subtle">Saved so far</dt>
          <dd className="tabular-nums">{plural(state.filesSaved, "file")}</dd>
        </div>
        {state.estimatedBatches ? (
          <div>
            <dt className="text-xs text-subtle">Batch</dt>
            <dd className="tabular-nums">
              {state.batchIndex} of ~{state.estimatedBatches}
            </dd>
          </div>
        ) : null}
      </dl>

      {state.failed > 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {plural(state.failed, "file")} could not be fetched and were skipped. Instagram media
          links expire, which is the usual cause.
        </p>
      ) : null}

      {state.error ? <p className="mt-3 text-sm text-muted">{state.error}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {state.status === "awaiting" && state.pending ? (
          <Button type="button" size="lg" className="flex-1" onClick={() => void archive.saveBatch()}>
            <Download className="size-4" />
            Save batch {state.batchIndex}
          </Button>
        ) : null}

        {busy ? (
          <Button type="button" size="lg" className="flex-1" disabled>
            <LoaderCircle className="size-4 animate-spin" />
            Working
          </Button>
        ) : null}

        {state.status === "done" || state.status === "cancelled" || state.status === "error" ? (
          <Button
            type="button"
            size="lg"
            className="flex-1"
            onClick={() => {
              archive.reset();
              onClose();
            }}
          >
            Close
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="lg" onClick={archive.cancel}>
            Stop
          </Button>
        )}
      </div>

      {state.status === "awaiting" ? (
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          Each zip is handed over one at a time — browsers block a run of downloads. Stopping here
          is safe: what you have saved is remembered, and resuming skips it.
        </p>
      ) : null}
    </div>
  );
}
