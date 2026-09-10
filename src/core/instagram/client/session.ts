import type { HttpTransport } from "./transport.ts";
import { DEFAULT_USER_AGENT, IG_APP_ID } from "./constants.ts";
import type { AuthCredentials } from "./auth.ts";
import { createSerialQueue } from "../../util/serial-queue.ts";

export type SessionOptions = {
  transport: HttpTransport;
  userAgent?: string;
  appId?: string;
  /** Injectable so tests are deterministic and core stays off global crypto. */
  randomToken?: () => string;
  /** Injectable so the authenticated throttle can be tested without waiting. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Minimum gap between requests once a session cookie is attached.
 *
 * Anonymous traffic is one of many; cookie-driven scraping is attributable to
 * an account and is specifically what Meta's automated-access detection
 * weights. Being slower authenticated than anonymous looks backwards until you
 * remember what is at stake: an anonymous block costs a retry, an account block
 * costs the account.
 */
const AUTHENTICATED_MIN_INTERVAL_MS = 1200;

function defaultToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * An Instagram session: a cookie jar, the anonymous bootstrap that mints a
 * csrftoken, and optionally a real login pasted in by the user.
 *
 * This is an instance rather than module state on purpose. One process-global
 * jar is harmless for a single anonymous user but makes per-account sessions
 * impossible, and would mean one person's cookies riding along on another's
 * requests.
 */
export class InstagramSession {
  private readonly jar = new Map<string, string>();
  private bootstrapping: Promise<void> | null = null;
  private readonly transport: HttpTransport;
  private readonly defaultUserAgent: string;
  private readonly appId: string;
  private readonly randomToken: () => string;
  private readonly sleep: (ms: number) => Promise<void>;

  private credentials: AuthCredentials | null = null;
  /** Serialises authenticated traffic so the interval below actually holds. */
  private readonly throttle = createSerialQueue();
  private lastRequestAt = 0;

  constructor(options: SessionOptions) {
    this.transport = options.transport;
    this.defaultUserAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.appId = options.appId ?? IG_APP_ID;
    this.randomToken = options.randomToken ?? defaultToken;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get isAuthenticated(): boolean {
    return this.credentials !== null;
  }

  /** The id of the signed-in account, or null. Never the session token. */
  get accountId(): string | null {
    return this.credentials?.dsUserId ?? null;
  }

  get userAgent(): string {
    // Match the browser the session was actually minted in, when we know it.
    return this.credentials?.userAgent || this.defaultUserAgent;
  }

  /**
   * Attach a user-supplied login. Clears any anonymous state first so the two
   * can never be half-mixed, which would send an anonymous csrftoken alongside
   * a real sessionid and look exactly like a forged request.
   */
  authenticate(credentials: AuthCredentials): void {
    this.jar.clear();
    this.credentials = credentials;
    this.jar.set("sessionid", credentials.sessionId);
    this.jar.set("ds_user_id", credentials.dsUserId);
    this.jar.set("csrftoken", credentials.csrfToken);
  }

  /** Drop the login and everything derived from it. */
  signOut(): void {
    this.credentials = null;
    this.jar.clear();
  }

  cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get cookies(): ReadonlyMap<string, string> {
    return this.jar;
  }

  storeCookies(res: Response): void {
    const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of raw) {
      const pair = c.split(";")[0];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      // Instagram routinely clears cookies it is rotating by setting them to a
      // tombstone. Letting that overwrite a pasted sessionid would silently log
      // the user out mid-archive.
      if (this.credentials && name === "sessionid" && (!value || value === '""')) continue;
      this.jar.set(name, value);
    }
  }

  /** Perform a request and fold any Set-Cookie back into the jar. */
  async request(url: string, init?: RequestInit): Promise<Response> {
    if (!this.credentials) {
      const res = await this.transport.request(url, init);
      this.storeCookies(res);
      return res;
    }
    return this.throttle.run(async () => {
      const since = Date.now() - this.lastRequestAt;
      if (since < AUTHENTICATED_MIN_INTERVAL_MS) {
        await this.sleep(AUTHENTICATED_MIN_INTERVAL_MS - since);
      }
      this.lastRequestAt = Date.now();
      const res = await this.transport.request(url, init);
      this.storeCookies(res);
      return res;
    });
  }

  /**
   * Ensure we hold a csrftoken. Concurrent callers share one in-flight
   * bootstrap rather than each opening their own. An authenticated session
   * already has one and must never anonymise itself.
   */
  async bootstrap(force = false): Promise<void> {
    if (this.credentials) return;
    if (!force && this.jar.has("csrftoken")) return;
    if (this.bootstrapping) return this.bootstrapping;
    this.bootstrapping = (async () => {
      if (force) this.jar.clear();
      const res = await this.transport.request("https://www.instagram.com/", {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      this.storeCookies(res);
      await res.arrayBuffer();
      if (!this.jar.has("csrftoken")) {
        // Instagram accepts a client-chosen token as long as header and cookie
        // agree, so a failed bootstrap does not have to be fatal.
        this.jar.set("csrftoken", this.randomToken());
      }
    })().finally(() => {
      this.bootstrapping = null;
    });
    return this.bootstrapping;
  }

  /** Headers for an authenticated-looking XHR to Instagram's private API. */
  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "User-Agent": this.userAgent,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.instagram.com",
      Referer: "https://www.instagram.com/",
      "X-CSRFToken": this.jar.get("csrftoken") || "",
      "X-IG-App-ID": this.appId,
      "X-Requested-With": "XMLHttpRequest",
      Cookie: this.cookieHeader(),
      ...extra,
    };
  }

  /** Headers for a plain document fetch, used when following share links. */
  documentHeaders(): Record<string, string> {
    return {
      "User-Agent": this.userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: this.cookieHeader(),
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
    };
  }
}
