import { useEffect, useMemo, useState } from "react";
import { Aperture } from "lucide-react";
import type { PostResult } from "@/core/instagram/types";
import { useDownloads } from "@/hooks/use-downloads";
import { useProfilePaging } from "@/hooks/use-profile-paging";
import { useResolve } from "@/hooks/use-resolve";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { HighlightFilter, LoadMoreBar, MediaGrid, TabLoading } from "./media-grid";
import { Lightbox } from "./lightbox";
import { ProfileHeader } from "./profile-header";
import { SearchBar } from "./search-bar";
import { SessionPanel } from "./session-panel";
import { EmptyTab, LoadingState, ResolveError } from "./states";

/**
 * Composition only. All state lives in the three hooks below, which is what
 * makes the components here replaceable for the React Native port while the
 * hooks survive as-is.
 */
export function KeepsakeApp() {
  const resolve = useResolve();
  const paging = useProfilePaging(resolve);
  const downloads = useDownloads(resolve, paging);
  const session = useSession();

  const { loading, result, profile, tab, setTab, rawPosts } = resolve;
  const [lightbox, setLightbox] = useState<{ post: PostResult; index: number } | null>(null);
  const [highlightFilter, setHighlightFilter] = useState("all");

  useEffect(() => {
    setHighlightFilter("all");
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
            onSaveProfile={() => void downloads.downloadProfile()}
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
          <MediaGrid
            posts={posts}
            wide={posts.length !== 1 || Boolean(profile)}
            busyKey={downloads.busyKey}
            onOpen={(post, index) => setLightbox({ post, index })}
            onDownloadPost={(post) => void downloads.downloadPost(post)}
          />
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
