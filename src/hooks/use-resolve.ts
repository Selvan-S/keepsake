import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PostResult, ProfileResult, ProfileTab, ResolveResult } from "@/core/instagram/types";

export type TabPage = { items: PostResult[]; cursor: string | null; hasMore: boolean };

/** Which tab a pasted link is asking for, before anything is fetched. */
export function tabFromQuery(q: string): ProfileTab {
  const lower = q.toLowerCase();
  if (lower.includes("/stories/")) return "stories";
  if (lower.includes("/highlights")) return "highlights";
  if (/instagram\.com\/[^/]+\/reels\/?(\?|$)/i.test(q)) return "reels";
  return "posts";
}

/**
 * Owns the search: the query, the in-flight request, and the result it
 * produces. Also owns `mergeTab`, because merging a page into the result is a
 * write to state this hook is the keeper of -- paging asks for it rather than
 * reaching into the result itself.
 */
export function useResolve() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [tab, setTab] = useState<ProfileTab>("posts");

  /**
   * Every search takes a ticket. Anything async that finishes after a newer
   * search started checks its ticket and discards its own result rather than
   * overwriting a fresher one.
   */
  const sessionRef = useRef(0);
  const resultRef = useRef(result);
  resultRef.current = result;

  const profile: ProfileResult | null =
    result && result.ok && result.mode === "profile" ? result.profile : null;

  const mergeTab = useCallback((tabId: ProfileTab, page: TabPage) => {
    setResult((current) => {
      if (!current || !current.ok || current.mode !== "profile") return current;
      const prev = current.profile[tabId];
      const seen = new Set(prev.items.map((p) => p.shortcode));
      // Cursors overlap in practice, so a page can repeat what we already hold.
      const extra = page.items.filter((p) => !seen.has(p.shortcode));
      const next: ResolveResult = {
        ok: true,
        mode: "profile",
        profile: {
          ...current.profile,
          [tabId]: {
            items: [...prev.items, ...extra],
            cursor: page.cursor ?? null,
            hasMore: Boolean(page.hasMore),
            loaded: true,
          },
        },
      };
      resultRef.current = next;
      return next;
    });
  }, []);

  const run = useCallback(
    async (next: string) => {
      const value = next.trim();
      if (!value) {
        toast.error("Paste a username or a public Instagram link.");
        return;
      }
      const session = ++sessionRef.current;
      setLoading(true);
      setResult(null);
      resultRef.current = null;
      setTab(tabFromQuery(value));
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
        resultRef.current = { ok: false, error: message };
        toast.error(message);
      } finally {
        if (sessionRef.current === session) setLoading(false);
      }
    },
    [],
  );

  const pasteAndGo = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("Clipboard is empty. Long-press the box and tap Paste.");
        return;
      }
      setQuery(text);
      await run(text);
    } catch {
      // Reading the clipboard needs permission the browser may simply refuse.
      toast.error("Long-press the box and tap Paste, then Fetch.");
    }
  }, [run]);

  /** The posts currently on screen: a single post result, or the active tab. */
  const rawPosts: PostResult[] = useMemo(() => {
    if (!result || !result.ok) return [];
    if (result.mode === "post") return result.posts;
    return result.profile[tab].items;
  }, [result, tab]);

  return {
    query,
    setQuery,
    loading,
    result,
    profile,
    tab,
    setTab,
    rawPosts,
    run,
    pasteAndGo,
    mergeTab,
    sessionRef,
    resultRef,
  };
}

export type ResolveApi = ReturnType<typeof useResolve>;
