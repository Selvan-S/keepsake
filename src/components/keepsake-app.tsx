import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Aperture,
  BadgeCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clapperboard,
  ClipboardPaste,
  Download,
  Film,
  Grid2x2,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { proxiedMediaUrl } from "@/lib/instagram/media-url";
import type {
  PostResult,
  ProfileFeed,
  ProfileResult,
  ProfileTab,
  ResolveResult,
} from "@/lib/instagram/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  { label: "@nasa", query: "nasa" },
  { label: "profile link", query: "https://www.instagram.com/nasa/" },
  { label: "NASA reel", query: "https://www.instagram.com/reel/Dbn-XJhk0_-/" },
];

const TABS: { id: ProfileTab; label: string; icon: typeof Grid2x2 }[] = [
  { id: "posts", label: "Posts", icon: Grid2x2 },
  { id: "reels", label: "Reels", icon: Clapperboard },
  { id: "stories", label: "Stories", icon: CircleDot },
  { id: "highlights", label: "Highlights", icon: Bookmark },
];

/**
 * Pages fetched per "Load the rest" click. A search itself fetches nothing
 * beyond the first page of previews: every request after that is one the user
 * asked for. Fewer requests per search is the most effective account-safety
 * measure available to us, and most searches never need page two.
 */
const REST_PAGES_PER_CLICK = 5;

/** Ceiling on how much one tab will accumulate, however many clicks. */
const TAB_CAP: Record<ProfileTab, number> = {
  posts: 120,
  reels: 48,
  stories: 50,
  highlights: 200,
};

const ZIP_LIMIT = 100;
const ZIP_BATCH = 6;
/** Per-file ceiling so one stalled CDN response cannot hang a whole archive. */
const MEDIA_TIMEOUT_MS = 45_000;

function tabFromQuery(q: string): ProfileTab {
  const lower = q.toLowerCase();
  if (lower.includes("/stories/")) return "stories";
  if (lower.includes("/highlights")) return "highlights";
  if (/instagram\.com\/[^/]+\/reels\/?(\?|$)/i.test(q)) return "reels";
  return "posts";
}

function formatCount(n: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

function formatDate(ts: number | null): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts * 1000));
}

function extFor(kind: "image" | "video", url: string): string {
  const lower = url.toLowerCase();
  if (kind === "video") return "mp4";
  if (lower.includes(".png")) return "png";
  if (lower.includes(".webp")) return "webp";
  return "jpg";
}

function safeSegment(value: string): string {
  return value.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "item";
}

function fileName(post: PostResult, index: number, kind: "image" | "video", url: string): string {
  const date = post.takenAt
    ? new Date(post.takenAt * 1000).toISOString().slice(0, 10)
    : "undated";
  const suffix = post.items.length > 1 ? `_${String(index + 1).padStart(2, "0")}` : "";
  const prefix = post.highlightTitle
    ? `${safeSegment(post.owner.username)}_${safeSegment(post.highlightTitle)}`
    : post.owner.username || "ig";
  return `${prefix}_${date}_${post.shortcode}${suffix}.${extFor(kind, url)}`.replace(/\s+/g, "_");
}

function archivePath(username: string, tab: ProfileTab, post: PostResult, index: number, kind: "image" | "video", url: string) {
  const name = fileName(post, index, kind, url);
  if (tab === "highlights" && post.highlightTitle) {
    return `${username}/highlights/${safeSegment(post.highlightTitle)}/${name}`;
  }
  return `${username}/${tab}/${name}`;
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function looksMobile() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
}

function isEmbedded() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function saveHref(url: string, name: string) {
  return proxiedMediaUrl(url, name);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function shareOrDownload(
  blob: Blob,
  name: string,
  href: string,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  try {
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return "shared";
    }
  } catch (error) {
    if (isAbort(error)) return "cancelled";
  }

  if (looksMobile() || isEmbedded()) {
    const opened = window.open(href, "_blank", "noopener");
    if (opened) return "downloaded";
    window.location.assign(href);
    return "downloaded";
  }

  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return "downloaded";
}

type ZipOutcome = {
  outcome: "shared" | "downloaded" | "cancelled";
  saved: number;
  failed: number;
};

async function zipMedia(entries: { name: string; url: string }[], zipName: string): Promise<ZipOutcome> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const slice = entries.slice(0, ZIP_LIMIT);
  let saved = 0;
  let failed = 0;
  for (let i = 0; i < slice.length; i += ZIP_BATCH) {
    const batch = slice.slice(i, i + ZIP_BATCH);
    await Promise.all(
      batch.map(async (entry) => {
        // One expired or unreachable CDN URL must not abort the whole archive,
        // so every failure is counted and reported rather than thrown or, worse,
        // dropped silently into a zip the caller then calls a success.
        try {
          const res = await fetch(proxiedMediaUrl(entry.url), {
            signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
          });
          if (!res.ok) {
            failed += 1;
            return;
          }
          zip.file(entry.name, await res.blob());
          saved += 1;
        } catch {
          failed += 1;
        }
      }),
    );
  }
  if (saved === 0) {
    throw new Error("None of those files could be fetched.");
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const href = URL.createObjectURL(blob);
  try {
    return { outcome: await shareOrDownload(blob, zipName, href), saved, failed };
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(href), 15_000);
  }
}

function entriesFromPosts(username: string, tab: ProfileTab, posts: PostResult[]) {
  return posts.flatMap((post) =>
    post.items.map((item, index) => ({
      name: archivePath(username, tab, post, index, item.kind, item.url),
      url: item.url,
    })),
  );
}

async function downloadPostZip(post: PostResult) {
  return zipMedia(
    post.items.map((item, index) => ({
      name: fileName(post, index, item.kind, item.url),
      url: item.url,
    })),
    `${post.owner.username}_${post.shortcode}.zip`,
  );
}

async function downloadFeedZip(username: string, tab: ProfileTab, posts: PostResult[]) {
  return zipMedia(entriesFromPosts(username, tab, posts), `${username}_${tab}.zip`);
}

async function downloadProfileZip(profile: ProfileResult) {
  const username = profile.username;
  const entries: { name: string; url: string }[] = [];
  if (profile.profilePicUrl) {
    entries.push({ name: `${username}/avatar.jpg`, url: profile.profilePicUrl });
  }
  const buckets: { tab: ProfileTab; cap: number }[] = [
    { tab: "stories", cap: 24 },
    { tab: "highlights", cap: 40 },
    { tab: "posts", cap: 30 },
    { tab: "reels", cap: 24 },
  ];
  for (const bucket of buckets) {
    const slice = entriesFromPosts(username, bucket.tab, profile[bucket.tab].items).slice(0, bucket.cap);
    entries.push(...slice);
  }
  return zipMedia(entries, `${username}_profile.zip`);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function saveToast({ outcome, saved, failed }: ZipOutcome, extra?: string) {
  if (outcome === "cancelled") return;
  // A partial archive is not a success — say what is missing rather than
  // handing over an incomplete zip under a green toast.
  if (failed > 0) {
    toast.warning(`Saved ${plural(saved, "file")} — ${plural(failed, "file")} could not be fetched.`);
    return;
  }
  if (outcome === "shared") {
    toast.success(extra || "Pick Save in the share sheet");
    return;
  }
  toast.success(extra || "If nothing appeared, press-and-hold the image to save");
}

function kindLabel(kind: PostResult["kind"]): string {
  if (kind === "carousel") return "Carousel";
  if (kind === "reel") return "Reel";
  if (kind === "video") return "Video";
  if (kind === "story") return "Story";
  if (kind === "highlight") return "Highlight";
  return "Photo";
}

function feedFor(profile: ProfileResult, tab: ProfileTab): ProfileFeed {
  return profile[tab];
}

function highlightTitles(posts: PostResult[]): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const post of posts) {
    const title = post.highlightTitle?.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

export function KeepsakeApp() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ post: PostResult; index: number } | null>(null);
  const [tab, setTab] = useState<ProfileTab>("posts");
  const [loadingMore, setLoadingMore] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [highlightFilter, setHighlightFilter] = useState<string>("all");
  const sessionRef = useRef(0);
  const resultRef = useRef(result);
  resultRef.current = result;
  const pagingLock = useRef(false);

  const profile: ProfileResult | null =
    result && result.ok && result.mode === "profile" ? result.profile : null;

  const rawPosts: PostResult[] = useMemo(() => {
    if (!result || !result.ok) return [];
    if (result.mode === "post") return result.posts;
    return feedFor(result.profile, tab).items;
  }, [result, tab]);

  const albums = tab === "highlights" ? highlightTitles(rawPosts) : [];
  const posts =
    tab === "highlights" && highlightFilter !== "all"
      ? rawPosts.filter((p) => p.highlightTitle === highlightFilter)
      : rawPosts;

  const feed = profile ? feedFor(profile, tab) : null;

  function mergeTab(tabId: ProfileTab, page: { items: PostResult[]; cursor: string | null; hasMore: boolean }) {
    setResult((current) => {
      if (!current || !current.ok || current.mode !== "profile") return current;
      const prev = current.profile[tabId];
      const seen = new Set(prev.items.map((p) => p.shortcode));
      const extra = page.items.filter((p) => !seen.has(p.shortcode));
      return {
        ok: true,
        mode: "profile",
        profile: {
          ...current.profile,
          [tabId]: {
            items: [...prev.items, ...extra],
            cursor: page.cursor ?? null,
            hasMore: Boolean(page.hasMore),
          },
        },
      };
    });
  }

  async function requestMore(tabId: ProfileTab, cursor: string, userId: string | null, username: string) {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, tab: tabId, cursor, userId }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      items?: PostResult[];
      cursor?: string | null;
      hasMore?: boolean;
    };
    if (!data.ok || !data.items) {
      throw new Error(data.error || "Could not load more.");
    }
    mergeTab(tabId, { items: data.items, cursor: data.cursor ?? null, hasMore: Boolean(data.hasMore) });
  }

  /**
   * Page the given tab as far as REST_PAGES_PER_CLICK / TAB_CAP allow. Only
   * ever called from the "Load the rest" button — nothing here runs on a plain
   * search. Because it is user-initiated it can simply decline when another
   * page request is in flight, rather than busy-waiting for the lock.
   */
  async function loadRest(tabId: ProfileTab, username: string, userId: string | null) {
    if (pagingLock.current) return;
    const session = sessionRef.current;
    pagingLock.current = true;
    setLoadingMore(true);
    try {
      for (let pages = 0; pages < REST_PAGES_PER_CLICK; pages += 1) {
        if (sessionRef.current !== session) return;
        const current = resultRef.current;
        if (!current || !current.ok || current.mode !== "profile") return;
        const next = current.profile[tabId];
        if (!next.hasMore || !next.cursor) break;
        if (next.items.length >= TAB_CAP[tabId]) break;
        setFillNote(`Loading more ${tabId}… ${next.items.length}+`);
        try {
          await requestMore(tabId, next.cursor, userId, username);
        } catch (error) {
          // Keep whatever loaded and stop, but say so instead of stalling with
          // no explanation.
          if (sessionRef.current === session) {
            toast.warning(
              error instanceof Error ? `Stopped loading ${tabId}: ${error.message}` : `Stopped loading more ${tabId}.`,
            );
          }
          break;
        }
        await sleep(280);
      }
    } finally {
      pagingLock.current = false;
      if (sessionRef.current === session) {
        setLoadingMore(false);
        setFillNote(null);
      }
    }
  }

  async function run(next = query) {
    const value = next.trim();
    if (!value) {
      toast.error("Paste a username or a public Instagram link.");
      return;
    }
    const session = ++sessionRef.current;
    setLoading(true);
    setResult(null);
    setTab(tabFromQuery(value));
    setHighlightFilter("all");
    setFillNote(null);
    try {
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value }),
      });
      const data = (await res.json()) as ResolveResult;
      if (sessionRef.current !== session) return;
      setResult(data);
      resultRef.current = data;
      if (!data.ok) toast.error(data.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      if (sessionRef.current !== session) return;
      setResult({ ok: false, error: message });
      toast.error(message);
    } finally {
      if (sessionRef.current === session) setLoading(false);
    }
  }

  async function pasteAndGo() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("Clipboard is empty. Long-press the box and tap Paste.");
        return;
      }
      setQuery(text);
      await run(text);
    } catch {
      toast.error("Long-press the box and tap Paste, then Fetch.");
    }
  }

  async function onDownloadPost(post: PostResult) {
    if (post.items.length <= 1) return;
    const key = `${post.shortcode}-all`;
    setBusyKey(key);
    try {
      saveToast(await downloadPostZip(post));
    } catch {
      toast.error("Could not save those files.");
    } finally {
      setBusyKey(null);
    }
  }

  async function onDownloadFeed() {
    if (!profile || posts.length === 0) return;
    setBusyKey("feed-tab");
    try {
      saveToast(await downloadFeedZip(profile.username, tab, posts));
    } catch {
      toast.error("Could not zip those files.");
    } finally {
      setBusyKey(null);
    }
  }

  async function onDownloadProfile() {
    if (!profile) return;
    setBusyKey("feed-all");
    try {
      const result = await downloadProfileZip(profile);
      saveToast(result, `Packed the public archive (${plural(result.saved, "file")})`);
    } catch {
      toast.error("Could not zip that profile.");
    } finally {
      setBusyKey(null);
    }
  }

  async function onLoadMore() {
    if (!profile || !feed?.hasMore || !feed.cursor) return;
    if (pagingLock.current) return;
    pagingLock.current = true;
    setLoadingMore(true);
    try {
      await requestMore(tab, feed.cursor, profile.userId, profile.username);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load more.");
    } finally {
      pagingLock.current = false;
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setHighlightFilter("all");
  }, [profile?.username]);

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
          <p className="stagger-in text-xs uppercase tracking-[0.18em] text-muted">Personal Instagram downloader</p>
          <h1 className="stagger-in mt-3 max-w-xl font-display text-[clamp(2.4rem,8vw,4.4rem)] leading-[1.05] tracking-[-0.035em]">
            Save the frame.
          </h1>
          <p className="stagger-in mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
            Paste a public username or profile link. Keepsake pulls posts, reels, and highlights into one archive you can save.
          </p>

          <form
            className="stagger-in mt-8 flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <label className="sr-only" htmlFor="ig-query">
              Instagram username or URL
            </label>
            <Input
              id="ig-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text/plain").trim();
                if (!text) return;
                e.preventDefault();
                setQuery(text);
                void run(text);
              }}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="@nasa or instagram.com/nasa"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              inputMode="url"
              className="h-12 sm:flex-1"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="h-12 flex-1 sm:flex-none"
                onClick={() => void pasteAndGo()}
                disabled={loading}
              >
                <ClipboardPaste className="size-4" />
                Paste
              </Button>
              <Button type="submit" size="lg" className="h-12 min-w-28 flex-1 sm:flex-none" disabled={loading}>
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {loading ? "Fetching" : "Fetch"}
              </Button>
            </div>
          </form>

          <div className="stagger-in mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-subtle">Try</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                className="h-9 rounded-full px-3 text-xs text-muted shadow-[var(--shadow-border)] transition-[color,box-shadow] duration-150 hover:text-fg hover:shadow-[var(--shadow-border-hover)]"
                onClick={() => {
                  setQuery(example.query);
                  void run(example.query);
                }}
              >
                {example.label}
              </button>
            ))}
          </div>
          <p className="stagger-in mt-3 text-xs leading-relaxed text-subtle">
            Private accounts will not load. Live stories only appear when Instagram still serves them. On a phone: long-press the box, tap Paste.
          </p>
        </section>

        {loading ? <LoadingState /> : null}

        {result && !result.ok && !loading ? (
          <div className="rounded-xl bg-bg-elevated px-5 py-6 shadow-[var(--shadow-border)]">
            <p className="font-display text-2xl tracking-[-0.03em]">Nothing came back</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{result.error}</p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-subtle">
              Use a public username like @nasa, or a post / reel link from Share → Copy link.
            </p>
          </div>
        ) : null}

        {profile && !loading ? (
          <ProfileHeader
            profile={profile}
            tab={tab}
            onTab={setTab}
            onSaveTab={() => void onDownloadFeed()}
            onSaveProfile={() => void onDownloadProfile()}
            savingTab={busyKey === "feed-tab"}
            savingProfile={busyKey === "feed-all"}
            fillNote={fillNote}
            archiveCount={archiveCount}
          />
        ) : null}

        {tab === "highlights" && albums.length > 1 ? (
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
            <FilterChip active={highlightFilter === "all"} onClick={() => setHighlightFilter("all")}>
              All {rawPosts.length}
            </FilterChip>
            {albums.map((title) => {
              const count = rawPosts.filter((p) => p.highlightTitle === title).length;
              return (
                <FilterChip
                  key={title}
                  active={highlightFilter === title}
                  onClick={() => setHighlightFilter(title)}
                >
                  {title} {count}
                </FilterChip>
              );
            })}
          </div>
        ) : null}

        {posts.length > 0 ? (
          <div className={cn("grid gap-5", posts.length === 1 && !profile ? "max-w-lg" : "sm:grid-cols-2")}>
            {posts.map((post, i) => (
              <PostCard
                key={`${post.kind}-${post.shortcode}-${i}`}
                post={post}
                index={i}
                busyKey={busyKey}
                onOpen={(itemIndex) => setLightbox({ post, index: itemIndex })}
                onDownloadAll={() => void onDownloadPost(post)}
              />
            ))}
          </div>
        ) : null}

        {profile && !loading && posts.length === 0 ? (
          <EmptyTab tab={tab} username={profile.username} hasPublicStory={profile.hasPublicStory} />
        ) : null}

        {profile && feed?.hasMore ? (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button type="button" variant="secondary" size="lg" onClick={() => void onLoadMore()} disabled={loadingMore}>
              {loadingMore ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {loadingMore ? "Loading" : "Load more"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => void loadRest(tab, profile.username, profile.userId)}
              disabled={loadingMore}
            >
              Load the rest
            </Button>
          </div>
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

function LoadingState() {
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

function EmptyTab({
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

function ProfileHeader({
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
  const stats = [
    archiveCount ? `${archiveCount}${feed.hasMore || profile.posts.hasMore || profile.reels.hasMore ? "+" : ""} saved` : null,
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {TABS.map((item) => {
          const Icon = item.icon;
          const count = profile[item.id].items.length;
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
              {count > 0 ? <span className="tabular-nums text-xs opacity-70">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          size="lg"
          className="h-11 flex-1"
          onClick={onSaveProfile}
          disabled={savingProfile || archiveCount === 0}
        >
          {savingProfile ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
          Save profile
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="h-11 flex-1"
          onClick={onSaveTab}
          disabled={savingTab || feed.items.length === 0}
        >
          {savingTab ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
          Save {tab}
        </Button>
      </div>
    </div>
  );
}

function SaveLink({
  href,
  name,
  children,
  className,
  variant = "primary",
  size = "sm",
}: {
  href: string;
  name: string;
  children: ReactNode;
  className?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "lg";
}) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={href} download={name} target="_blank" rel="noopener">
        {children}
      </a>
    </Button>
  );
}

function PostCard({
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
            src={proxiedMediaUrl(cover.thumbnailUrl || cover.url)}
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
                    src={proxiedMediaUrl(item.thumbnailUrl || item.url)}
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

function Lightbox({
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
            src={proxiedMediaUrl(item.url)}
            poster={proxiedMediaUrl(item.thumbnailUrl)}
            className="max-h-full max-w-full rounded-lg object-contain"
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            src={proxiedMediaUrl(item.url)}
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
