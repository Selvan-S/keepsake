import { proxiedMediaUrl } from "@/lib/instagram/media-url";

/**
 * How a finished file reaches the user. This is a deliberate platform seam:
 * web uses the Web Share API and `<a download>`; React Native swaps in
 * save-to-camera-roll behind the same signature (Phase 4). Nothing above this
 * module should know which of those is happening.
 */

export type SaveOutcome = "shared" | "downloaded" | "cancelled";

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function looksMobile(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent)
  );
}

function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin frame throws on this read, which is itself the answer.
    return true;
  }
}

/** A link that saves one media file under a chosen name, via the proxy. */
export function saveHref(url: string, name: string): string {
  return proxiedMediaUrl(url, name);
}

/**
 * Hand a blob to the user by the best route this device offers.
 *
 * The share sheet is tried first because on a phone it is the only route that
 * reaches Photos. A dismissed sheet is reported as "cancelled" rather than
 * falling through to a download the user just declined.
 */
export async function shareOrDownload(
  blob: Blob,
  name: string,
  href: string,
): Promise<SaveOutcome> {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  try {
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return "shared";
    }
  } catch (error) {
    if (isAbort(error)) return "cancelled";
    // Any other share failure falls through to a plain download.
  }

  // An `<a download>` is ignored inside an iframe and unreliable on mobile
  // browsers, so those navigate instead.
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
