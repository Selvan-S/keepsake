/**
 * The seam between Instagram knowledge and the platform underneath it.
 *
 * Everything in `core/` goes through this and never calls `fetch` directly, so
 * the same code runs on a Node server, in React Native against native HTTP, or
 * against a stub in tests. Deliberately shaped like `fetch` and nothing more:
 * anything richer would leak a platform assumption back into core.
 */
export interface HttpTransport {
  request(url: string, init?: RequestInit): Promise<Response>;
}

/** A transport backed by whatever global `fetch` is in scope. */
export function globalFetchTransport(): HttpTransport {
  return { request: (url, init) => fetch(url, init) };
}
