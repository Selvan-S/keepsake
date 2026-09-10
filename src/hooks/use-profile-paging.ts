import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PostResult, ProfileTab } from "@/core/instagram/types";
import { createSerialQueue } from "@/core/util/serial-queue";
import type { ResolveApi } from "./use-resolve";

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

/** Spacing between consecutive page requests, for the same reason as the caps. */
const REQUEST_SPACING_MS = 280;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Owns everything that fetches more of a profile after the first page: opening
 * a deferred tab, "Load more", and "Load the rest".
 *
 * All three go through one serial queue, so they cannot interleave requests to
 * Instagram no matter how the user clicks.
 */
export function useProfilePaging(resolve: ResolveApi) {
  const { profile, tab, mergeTab, sessionRef, resultRef } = resolve;
  const [loadingMore, setLoadingMore] = useState(false);
  const [tabLoading, setTabLoading] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const queue = useRef(createSerialQueue());
  const tabLoads = useRef(new Map<ProfileTab, Promise<void>>());

  const requestMore = useCallback(
    async (tabId: ProfileTab, cursor: string | null, userId: string | null, username: string) => {
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
      mergeTab(tabId, {
        items: data.items,
        cursor: data.cursor ?? null,
        hasMore: Boolean(data.hasMore),
      });
    },
    [mergeTab],
  );

  /**
   * Fetch a tab that a search deliberately skipped. Deduplicated on the tab, so
   * flipping quickly between tabs cannot stack up duplicate requests -- which
   * would undo the point of not fetching them in the first place.
   */
  const ensureTabLoaded = useCallback(
    async (tabId: ProfileTab): Promise<void> => {
      const current = resultRef.current;
      if (!current || !current.ok || current.mode !== "profile") return;
      if (current.profile[tabId].loaded) return;
      const pending = tabLoads.current.get(tabId);
      if (pending) return pending;

      const session = sessionRef.current;
      const { username, userId } = current.profile;
      const task = (async () => {
        setTabLoading(true);
        try {
          await queue.current.run(() => requestMore(tabId, null, userId, username));
        } catch (error) {
          if (sessionRef.current === session) {
            toast.error(error instanceof Error ? error.message : `Could not load ${tabId}.`);
            // Mark it loaded-but-empty so the tab settles on a real message
            // instead of retrying on every render.
            mergeTab(tabId, { items: [], cursor: null, hasMore: false });
          }
        } finally {
          tabLoads.current.delete(tabId);
          if (sessionRef.current === session) setTabLoading(false);
        }
      })();
      tabLoads.current.set(tabId, task);
      return task;
    },
    [mergeTab, requestMore, resultRef, sessionRef],
  );

  const loadMore = useCallback(async () => {
    if (!profile) return;
    const feed = profile[tab];
    if (!feed.hasMore || !feed.cursor) return;
    setLoadingMore(true);
    try {
      await queue.current.run(() => requestMore(tab, feed.cursor, profile.userId, profile.username));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  }, [profile, requestMore, tab]);

  /**
   * Page the given tab as far as REST_PAGES_PER_CLICK / TAB_CAP allow. Only
   * ever called from the "Load the rest" button -- nothing here runs on a plain
   * search.
   */
  const loadRest = useCallback(
    async (tabId: ProfileTab) => {
      const current = resultRef.current;
      if (!current || !current.ok || current.mode !== "profile") return;
      const { username, userId } = current.profile;
      const session = sessionRef.current;
      setLoadingMore(true);
      try {
        for (let pages = 0; pages < REST_PAGES_PER_CLICK; pages += 1) {
          if (sessionRef.current !== session) return;
          const latest = resultRef.current;
          if (!latest || !latest.ok || latest.mode !== "profile") return;
          const next = latest.profile[tabId];
          if (!next.hasMore || !next.cursor) break;
          if (next.items.length >= TAB_CAP[tabId]) break;
          setFillNote(`Loading more ${tabId}… ${next.items.length}+`);
          try {
            await queue.current.run(() => requestMore(tabId, next.cursor, userId, username));
          } catch (error) {
            // Keep whatever loaded and stop, but say so instead of stalling
            // with no explanation.
            if (sessionRef.current === session) {
              toast.warning(
                error instanceof Error
                  ? `Stopped loading ${tabId}: ${error.message}`
                  : `Stopped loading more ${tabId}.`,
              );
            }
            break;
          }
          await sleep(REQUEST_SPACING_MS);
        }
      } finally {
        if (sessionRef.current === session) {
          setLoadingMore(false);
          setFillNote(null);
        }
      }
    },
    [requestMore, resultRef, sessionRef],
  );

  // A search loads only the Posts preview; whichever tab the user opens is
  // fetched here, once.
  useEffect(() => {
    if (!profile || profile[tab].loaded) return;
    void ensureTabLoaded(tab);
  }, [ensureTabLoaded, profile, tab]);

  return { loadingMore, tabLoading, fillNote, loadMore, loadRest, ensureTabLoaded };
}

export type PagingApi = ReturnType<typeof useProfilePaging>;
