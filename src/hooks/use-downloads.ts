import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { PostResult } from "@/core/instagram/types";
import { plural } from "@/core/archive/naming";
import { downloadPostZip, type ZipOutcome } from "@/lib/download/zip";

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

/** Owns the zip/share work and the "which button is busy" state behind it. */
export function useDownloads() {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const guard = useCallback(async (key: string, message: string, work: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await work();
    } catch {
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  }, []);

  const downloadPost = useCallback(
    (post: PostResult) => {
      if (post.items.length <= 1) return;
      return guard(`${post.shortcode}-all`, "Could not save those files.", async () => {
        saveToast(await downloadPostZip(post));
      });
    },
    [guard],
  );

  return { busyKey, downloadPost };
}
