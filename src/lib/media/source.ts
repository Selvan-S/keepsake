import { proxiedMediaUrl } from "@/lib/instagram/media-url";

/**
 * How a media URL becomes something this platform can display or fetch.
 *
 * A deliberate seam, and the last hard-coded web assumption outside the
 * components themselves. On the web, Instagram's CDN is hotlink-protected and
 * CORS-blocked, so every URL has to be laundered through `/api/media`. React
 * Native's networking is native HTTP: no CORS, arbitrary headers, no proxy
 * needed — so the mobile implementation of this module is the identity
 * function, and `/api/media` and `media-url.ts` are deleted with it.
 *
 * Callers pass the canonical CDN URL that `core/` produced and never construct
 * a proxy path themselves. That is what keeps the swap to one file.
 */

/** A URL suitable for an <img>/<video> source on this platform. */
export function displayUrl(url: string): string {
  return proxiedMediaUrl(url);
}

/**
 * A URL that, when followed, saves the file under `name`.
 *
 * On the web this is the proxy again, because only the server can set
 * `content-disposition`. On mobile there is no URL involved at all — the file
 * is written to the camera roll — which is why callers must treat this as
 * opaque rather than assuming it is fetchable.
 */
export function downloadUrl(url: string, name: string): string {
  return proxiedMediaUrl(url, name);
}

/**
 * A URL for reading the bytes into memory, e.g. to build a zip.
 *
 * Separate from `displayUrl` because the platforms diverge: the web needs the
 * proxy to get past CORS even though the pixels are the same, while mobile
 * reads the CDN directly.
 */
export function fetchUrl(url: string): string {
  return proxiedMediaUrl(url);
}
