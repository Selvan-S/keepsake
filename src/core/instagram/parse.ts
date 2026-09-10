export type ProfileTab = "posts" | "reels" | "stories" | "highlights";

export type ParsedQuery =
  | { kind: "post"; shortcode: string }
  | { kind: "share"; href: string }
  | { kind: "profile"; username: string; tab?: ProfileTab };

export type ParseResult = {
  items: ParsedQuery[];
  error?: string;
};

const RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "accounts",
  "explore",
  "direct",
  "about",
  "legal",
  "developer",
  "lite",
  "ids",
  "share",
  "s",
  "highlights",
]);

const SHORTCODE = /^[A-Za-z0-9_-]{5,32}$/;
const USERNAME = /^[a-z0-9._]{1,30}$/;

function tidyUrl(raw: string): string {
  return raw.trim().replace(/[).,;:!?]+$/g, "");
}

function hostname(url: URL): string {
  return url.hostname.replace(/^www\./i, "").replace(/^m\./i, "").toLowerCase();
}

function isInstagramHost(host: string): boolean {
  return host === "instagram.com" || host === "instagr.am" || host === "l.instagram.com";
}

function unwrap(raw: string): string {
  try {
    const url = new URL(raw);
    if (hostname(url) === "l.instagram.com") {
      const inner = url.searchParams.get("u");
      if (inner) return unwrap(inner);
    }
    const next = url.searchParams.get("next");
    if (next && /instagram\.com|instagr\.am/i.test(next)) {
      return unwrap(next);
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

export function extractShortcodeFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "share") return null;
  const marker = parts.findIndex((p) => p === "p" || p === "reel" || p === "reels" || p === "tv");
  if (marker >= 0) {
    const code = parts[marker + 1];
    if (code && SHORTCODE.test(code)) return code;
  }
  return null;
}

export function extractUsernameFromPath(pathname: string): { username: string; tab?: ProfileTab } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]?.toLowerCase() ?? "";
  if (first === "stories" && parts[1] && parts[1] !== "highlights") {
    const name = parts[1].toLowerCase();
    if (USERNAME.test(name) && !RESERVED.has(name)) return { username: name, tab: "stories" };
    return null;
  }
  if (RESERVED.has(first)) return null;
  if (!USERNAME.test(first)) return null;
  if (parts.length === 1) return { username: first };
  if (parts.length === 2) {
    if (parts[1] === "reels") return { username: first, tab: "reels" };
    if (parts[1] === "highlights") return { username: first, tab: "highlights" };
  }
  return null;
}

function absoluteHref(raw: string): string {
  const cleaned = tidyUrl(raw);
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
}

export function parseInstagramUrl(raw: string): ParsedQuery | { kind: "stories" } | null {
  const cleaned = unwrap(tidyUrl(raw));
  const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  if (!isInstagramHost(hostname(url))) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "s") return { kind: "stories" };
  if (parts[0] === "share") {
    if (!parts[1]) return null;
    return { kind: "share", href: `https://www.instagram.com${url.pathname}${url.search}` };
  }
  const shortcode = extractShortcodeFromPath(url.pathname);
  if (shortcode) return { kind: "post", shortcode };
  const username = extractUsernameFromPath(url.pathname);
  if (username) return { kind: "profile", ...username };
  if (url.pathname.includes("/stories/")) return { kind: "stories" };
  return null;
}

function parseToken(raw: string): ParsedQuery | { kind: "stories" } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("@")) {
    const username = trimmed.slice(1).toLowerCase();
    if (USERNAME.test(username)) return { kind: "profile", username };
    return null;
  }

  const asUrl = parseInstagramUrl(trimmed);
  if (asUrl) return asUrl;

  if (/^[A-Za-z0-9_-]{8,20}$/.test(trimmed) && /[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed)) {
    return { kind: "post", shortcode: trimmed };
  }

  const username = trimmed.replace(/^@/, "").toLowerCase();
  if (USERNAME.test(username) && !username.includes("..")) {
    return { kind: "profile", username };
  }

  return null;
}

// The leading lookbehind is what stops the host from being matched mid-domain:
// without it, `notinstagram.com/p/ABC` yields the substring `instagram.com/p/ABC`
// and a foreign link silently resolves against the real Instagram.
const URL_IN_TEXT =
  /(?<![\w.-])(?:https?:\/\/)?(?:(?:www|m|l)\.)?(?:instagram\.com|instagr\.am)\/[^\s<>"']+/gi;

export function shortcodeFromRedirectTarget(raw: string): string | null {
  const parsed = parseInstagramUrl(raw);
  if (parsed?.kind === "post") return parsed.shortcode;
  try {
    const url = new URL(absoluteHref(raw));
    const next = url.searchParams.get("next");
    if (next) {
      // Instagram's login bounce uses a relative target (`?next=/p/CODE/`), so
      // resolve against the redirect's own origin before parsing it.
      const nested = parseInstagramUrl(new URL(next, url).toString());
      if (nested?.kind === "post") return nested.shortcode;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function parseQuery(input: string): ParseResult {
  const urls = [...input.matchAll(URL_IN_TEXT)].map((m) => tidyUrl(m[0]));
  const igUrls = urls.filter((u) => {
    try {
      return isInstagramHost(hostname(new URL(absoluteHref(u))));
    } catch {
      return /instagram\.com|instagr\.am/i.test(u);
    }
  });

  const trimmed = input.trim();
  const tokens = igUrls.length > 0 ? igUrls : trimmed && !/\s/.test(trimmed) ? [trimmed] : [];

  const seen = new Set<string>();
  const items: ParsedQuery[] = [];
  let sawStories = false;

  for (const token of tokens) {
    const parsed = igUrls.length > 0 ? parseInstagramUrl(token) : parseToken(token);
    if (!parsed) continue;
    if (parsed.kind === "stories") {
      sawStories = true;
      continue;
    }
    const key =
      parsed.kind === "post"
        ? `p:${parsed.shortcode}`
        : parsed.kind === "share"
          ? `s:${parsed.href}`
          : `u:${parsed.username}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(parsed);
  }

  if (items.length === 0 && sawStories) {
    return {
      items,
      error: "That looks like a highlight share link. Paste the profile username instead, then open Highlights.",
    };
  }

  if (items.length === 0) {
    return {
      items,
      error: "Paste a username, profile link, or a public post / reel link.",
    };
  }

  return { items };
}

/**
 * Recover a shortcode from a fetched HTML page, for share links that resolve by
 * rendering rather than redirecting. Instagram puts the real permalink in the
 * canonical link or the og:url meta tag.
 */
export function shortcodeFromHtml(html: string): string | null {
  const attrs = [
    html.match(/rel="canonical"\s+href="([^"]+)"/i)?.[1],
    html.match(/href="([^"]+)"\s+rel="canonical"/i)?.[1],
    html.match(/property="og:url"\s+content="([^"]+)"/i)?.[1],
  ];
  for (const value of attrs) {
    if (!value) continue;
    const code = shortcodeFromRedirectTarget(value.replace(/&/g, "&"));
    if (code) return code;
  }
  return null;
}
