import type { HttpTransport } from "./transport.ts";
import { DEFAULT_USER_AGENT, IG_APP_ID } from "./constants.ts";

export type SessionOptions = {
  transport: HttpTransport;
  userAgent?: string;
  appId?: string;
  /** Injectable so tests are deterministic and core stays off global crypto. */
  randomToken?: () => string;
};

function defaultToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

/**
 * A logged-out Instagram session: a cookie jar plus the anonymous bootstrap
 * that mints a csrftoken.
 *
 * This is an instance rather than module state on purpose. One process-global
 * jar is harmless for a single user but makes per-account sessions impossible,
 * and on mobile it would mean every account sharing one cookie set.
 */
export class InstagramSession {
  private readonly jar = new Map<string, string>();
  private bootstrapping: Promise<void> | null = null;
  private readonly transport: HttpTransport;
  private readonly userAgent: string;
  private readonly appId: string;
  private readonly randomToken: () => string;

  constructor(options: SessionOptions) {
    this.transport = options.transport;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.appId = options.appId ?? IG_APP_ID;
    this.randomToken = options.randomToken ?? defaultToken;
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
      this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  /** Perform a request and fold any Set-Cookie back into the jar. */
  async request(url: string, init?: RequestInit): Promise<Response> {
    const res = await this.transport.request(url, init);
    this.storeCookies(res);
    return res;
  }

  /**
   * Ensure we hold a csrftoken. Concurrent callers share one in-flight
   * bootstrap rather than each opening their own.
   */
  async bootstrap(force = false): Promise<void> {
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
