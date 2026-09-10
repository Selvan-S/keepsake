/**
 * Optional authenticated session.
 *
 * Keepsake never sees a password. The user logs in with a real browser they
 * control and pastes the resulting cookies here, so the only secret this code
 * ever touches is an already-minted session token. See PLAN.md Phase 3 for why
 * that beats an in-app WebView login.
 *
 * What a session buys: exactly what that account can see in a browser. It does
 * NOT unlock private accounts the account does not already follow. It unlocks
 * stories and highlights, which need a login even for public accounts.
 */

export type AuthCredentials = {
  sessionId: string;
  dsUserId: string;
  csrfToken: string;
  /**
   * The User-Agent of the browser the session was actually minted in.
   *
   * Optional but strongly wanted: a session created in desktop Firefox that
   * then makes every request as a Pixel 8 is a contradiction, and inconsistency
   * is exactly what automated-access detection weights. Absent, we keep the
   * default and say so in the UI.
   */
  userAgent?: string;
};

export const SESSION_REJECTED_MESSAGE =
  "Instagram rejected the saved session. It has probably expired — sign out and paste fresh cookies.";

export class SessionRejectedError extends Error {
  constructor() {
    super(SESSION_REJECTED_MESSAGE);
    this.name = "SessionRejectedError";
  }
}

/** Cookie names we accept, mapped to the field they fill. */
const FIELD_BY_COOKIE: Record<string, keyof AuthCredentials> = {
  sessionid: "sessionId",
  ds_user_id: "dsUserId",
  csrftoken: "csrfToken",
};

/**
 * Shape checks. These are not security boundaries -- Instagram is the only
 * thing that can say whether a cookie is valid -- but they catch the common
 * paste mistakes (wrong cookie, truncated value, whole JSON blob in one box)
 * before we spend a request finding out.
 */
const SHAPES: Record<keyof Omit<AuthCredentials, "userAgent">, RegExp> = {
  // e.g. "12345678%3AAbCdEf...%3A26%3AAY..." -- digits, then percent-encoded
  // separators. Kept loose because the tail format has changed before.
  sessionId: /^[0-9]+(%3A|:)[\w%.-]{10,}$/i,
  dsUserId: /^[0-9]{4,20}$/,
  csrfToken: /^[A-Za-z0-9]{16,64}$/,
};

const LABELS: Record<keyof Omit<AuthCredentials, "userAgent">, string> = {
  sessionId: "sessionid",
  dsUserId: "ds_user_id",
  csrfToken: "csrftoken",
};

export type CredentialParse =
  | { ok: true; credentials: AuthCredentials }
  | { ok: false; error: string };

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^["']/.test(trimmed) && trimmed.endsWith(trimmed[0]!)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Pull cookie values out of whatever the user pasted.
 *
 * People paste a bare value, `name=value`, a whole `Cookie:` header, or the
 * JSON a cookie extension exports. All of those are the same intent, and
 * rejecting three of the four teaches people to fiddle with secrets in a text
 * editor -- which is worse than parsing them here.
 */
export function extractCookies(input: string): Partial<Record<string, string>> {
  const found: Record<string, string> = {};
  const text = input.trim();
  if (!text) return found;

  // A cookie-extension JSON export: [{ name, value }, ...] or { cookies: [...] }.
  if (/^[[{]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { cookies?: unknown })?.cookies)
          ? (parsed as { cookies: unknown[] }).cookies
          : [];
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const rec = entry as { name?: unknown; value?: unknown };
        if (typeof rec.name !== "string" || typeof rec.value !== "string") continue;
        const key = rec.name.trim().toLowerCase();
        if (key in FIELD_BY_COOKIE) found[key] = rec.value.trim();
      }
      if (Object.keys(found).length > 0) return found;
    } catch {
      // Not JSON after all; fall through to the pair scan.
    }
  }

  // `name=value` pairs, separated by ';' or newlines. A leading "Cookie:" is
  // common when copied from devtools and is simply ignored.
  for (const chunk of text.replace(/^cookie:\s*/i, "").split(/[;\n\r]+/)) {
    const eq = chunk.indexOf("=");
    if (eq <= 0) continue;
    const key = chunk.slice(0, eq).trim().toLowerCase();
    if (key in FIELD_BY_COOKIE) found[key] = stripQuotes(chunk.slice(eq + 1));
  }
  return found;
}

/**
 * Turn three pasted fields into credentials, or say precisely what is wrong.
 *
 * Each field also accepts the `name=value` and blob forms, so pasting the whole
 * cookie header into any one box works.
 */
export function parseCredentials(input: {
  sessionId: string;
  dsUserId: string;
  csrfToken: string;
  userAgent?: string;
}): CredentialParse {
  // Anything pasted into any box may carry all three; later boxes do not
  // overwrite values an earlier one already supplied explicitly.
  const scanned: Record<string, string> = {};
  for (const raw of [input.sessionId, input.dsUserId, input.csrfToken]) {
    for (const [key, value] of Object.entries(extractCookies(raw || ""))) {
      if (value && !scanned[key]) scanned[key] = value;
    }
  }

  const direct: Record<keyof typeof SHAPES, string> = {
    sessionId: stripQuotes(input.sessionId || ""),
    dsUserId: stripQuotes(input.dsUserId || ""),
    csrfToken: stripQuotes(input.csrfToken || ""),
  };

  const resolved = {} as Record<keyof typeof SHAPES, string>;
  for (const field of Object.keys(SHAPES) as (keyof typeof SHAPES)[]) {
    const cookieName = LABELS[field];
    const value = direct[field];
    // Prefer the raw box when it already looks like the value itself; fall back
    // to whatever a pasted blob supplied.
    resolved[field] = SHAPES[field].test(value) ? value : (scanned[cookieName] ?? value);
  }

  const missing = (Object.keys(SHAPES) as (keyof typeof SHAPES)[]).filter((f) => !resolved[f]);
  if (missing.length > 0) {
    return { ok: false, error: `Missing ${missing.map((f) => LABELS[f]).join(", ")}.` };
  }
  const malformed = (Object.keys(SHAPES) as (keyof typeof SHAPES)[]).filter(
    (f) => !SHAPES[f].test(resolved[f]),
  );
  if (malformed.length > 0) {
    return {
      ok: false,
      error: `That does not look like a ${malformed.map((f) => LABELS[f]).join(" or ")} value. Copy it from the cookie list, not the page.`,
    };
  }

  const userAgent = (input.userAgent || "").trim();
  return {
    ok: true,
    credentials: {
      sessionId: resolved.sessionId,
      dsUserId: resolved.dsUserId,
      csrfToken: resolved.csrfToken,
      ...(userAgent ? { userAgent } : {}),
    },
  };
}

/**
 * True when a response is Instagram refusing the session specifically, rather
 * than refusing the thing we asked for. Distinguishing these is what lets the
 * UI say "paste fresh cookies" instead of failing opaquely.
 */
export function isSessionRejected(status: number, root: Record<string, unknown> | null): boolean {
  if (status === 401) return true;
  const message = typeof root?.message === "string" ? root.message.toLowerCase() : "";
  const requiresLogin = root?.requires_login === true;
  return (
    requiresLogin ||
    message.includes("login_required") ||
    message.includes("checkpoint_required") ||
    message.includes("challenge_required")
  );
}

/** Never log or return a secret; this is what is safe to show. */
export function redact(credentials: AuthCredentials): string {
  return `ds_user_id=${credentials.dsUserId} sessionid=***${credentials.sessionId.slice(-4)}`;
}
