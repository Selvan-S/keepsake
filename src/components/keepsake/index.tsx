import { useCallback, useEffect, useMemo, useState } from "react";
import { Aperture } from "lucide-react";
import type { PostResult } from "@/core/instagram/types";
import { useDownloads } from "@/hooks/use-downloads";
import { useProfilePaging } from "@/hooks/use-profile-paging";
import { useResolve } from "@/hooks/use-resolve";
import { useSession } from "@/hooks/use-session";
import { useArchive } from "@/hooks/use-archive";
import { cn } from "@/lib/utils";
import { GRID_PAGE, HighlightFilter, LoadMoreBar, MediaGrid, ShowMore, TabLoading } from "./media-grid";
import { Lightbox } from "./lightbox";
import { ProfileHeader } from "./profile-header";
import { SearchBar } from "./search-bar";
import { SessionPanel } from "./session-panel";
import { ArchiveDialog } from "./archive-dialog";
import { EmptyTab, LoadingState, ResolveError } from "./states";

/**
 * Composition only. All state lives in the three hooks below, which is what
 * makes the components here replaceable for the React Native port while the
 * hooks survive as-is.
 */
export function KeepsakeApp() {
  const resolve = useResolve();
  const paging = useProfilePaging(resolve);
  const downloads = useDownloads(resolve);
  const session = useSession();
  const archive = useArchive(resolve, paging);

  const { loading, result, profile, tab, setTab, rawPosts } = resolve;
  const [lightbox, setLightbox] = useState<{ post: PostResult; index: number } | null>(null);
  const [highlightFilter, setHighlightFilter] = useState("all");
  const [archiveOpen, setArchiveOpen] = useState(false);
  // How many tiles are rendered, independent of how many are loaded.
  const [visible, setVisible] = useState(GRID_PAGE);

  // Stable identities, so memoised tiles are not reconciled on every archive
  // progress tick.
  const openLightbox = useCallback((post: PostResult, index: number) => {
    setLightbox({ post, index });
  }, []);
  const downloadPost = useCallback(
    (post: PostResult) => {
      void downloads.downloadPost(post);
    },
    [downloads],
  );

  useEffect(() => {
    setHighlightFilter("all");
    setVisible(GRID_PAGE);
  }, [profile?.username, tab]);

  const albums = useMemo(() => {
    if (tab !== "highlights") return [];
    const seen = new Set<string>();
    const titles: string[] = [];
    for (const post of rawPosts) {
      const title = post.highlightTitle?.trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      titles.push(title);
    }
    return titles;
  }, [rawPosts, tab]);

  const albumCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of rawPosts) {
      const title = post.highlightTitle?.trim();
      if (title) counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    return counts;
  }, [rawPosts]);

  const posts =
    tab === "highlights" && highlightFilter !== "all"
      ? rawPosts.filter((p) => p.highlightTitle === highlightFilter)
      : rawPosts;

  const feed = profile ? profile[tab] : null;
  const archiveCount = profile
    ? profile.posts.items.length +
      profile.reels.items.length +
      profile.stories.items.length +
      profile.highlights.items.length
    : 0;

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-bg text-fg">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 hero-wash" />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[10px] shadow-[var(--shadow-border)]">
            <Aperture className="size-4 text-fg" strokeWidth={1.6} />
          </span>
          <span className="font-display text-xl tracking-[-0.03em]">Keepsake</span>
        </div>
        <p className="text-xs uppercase tracking-[0.16em] text-subtle">Public archive</p>
      </header>

      <main className="relative mx-auto w-full max-w-5xl px-5 pb-24 sm:px-8">
        <section className={cn("pt-6 sm:pt-10", posts.length || profile ? "pb-8" : "pb-4")}>
          <p className="stagger-in text-xs uppercase tracking-[0.18em] text-muted">
            Personal Instagram downloader
          </p>
          <h1 className="stagger-in mt-3 max-w-xl font-display text-[clamp(2.4rem,8vw,4.4rem)] leading-[1.05] tracking-[-0.035em]">
            Save the frame.
          </h1>
          <p className="stagger-in mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
            Paste a public username or profile link. Keepsake pulls posts, reels, and highlights into one
            archive you can save.
          </p>
          <SearchBar
            query={resolve.query}
            onQuery={resolve.setQuery}
            onRun={(value) => void resolve.run(value)}
            onPaste={() => void resolve.pasteAndGo()}
            loading={loading}
          />
          <SessionPanel session={session} />
        </section>

        {loading ? <LoadingState /> : null}

        {result && !result.ok && !loading ? <ResolveError error={result.error} /> : null}

        {profile && !loading ? (
          <ProfileHeader
            profile={profile}
            tab={tab}
            onTab={setTab}
            onSaveTab={() => void downloads.downloadTab(tab, posts)}
            onSaveProfile={() => setArchiveOpen(true)}
            savingTab={downloads.busyKey === "feed-tab"}
            savingProfile={downloads.busyKey === "feed-all"}
            fillNote={paging.fillNote}
            archiveCount={archiveCount}
          />
        ) : null}

        {tab === "highlights" && albums.length > 1 ? (
          <HighlightFilter
            albums={albums}
            active={highlightFilter}
            total={rawPosts.length}
            counts={albumCounts}
            onSelect={setHighlightFilter}
          />
        ) : null}

        {posts.length > 0 ? (
          <>
            <MediaGrid
              posts={posts.slice(0, visible)}
              wide={posts.length !== 1 || Boolean(profile)}
              busyKey={downloads.busyKey}
              onOpen={openLightbox}
              onDownloadPost={downloadPost}
            />
            <ShowMore
              shown={Math.min(visible, posts.length)}
              total={posts.length}
              onMore={() => setVisible((v) => v + GRID_PAGE)}
            />
          </>
        ) : null}

        {profile && (loading || paging.tabLoading) && posts.length === 0 ? <TabLoading tab={tab} /> : null}

        {profile && !loading && !paging.tabLoading && posts.length === 0 ? (
          <EmptyTab tab={tab} username={profile.username} hasPublicStory={profile.hasPublicStory} />
        ) : null}

        {profile && feed?.hasMore ? (
          <LoadMoreBar
            loading={paging.loadingMore}
            onLoadMore={() => void paging.loadMore()}
            onLoadRest={() => void paging.loadRest(tab)}
          />
        ) : null}
      </main>

      {archiveOpen && profile ? (
        <ArchiveDialog
          profile={profile}
          archive={archive}
          authenticated={session.authenticated}
          onClose={() => setArchiveOpen(false)}
        />
      ) : null}

      {lightbox ? (
        <Lightbox
          post={lightbox.post}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(next) => setLightbox({ post: lightbox.post, index: next })}
        />
      ) : null}
    </div>
  );
}
