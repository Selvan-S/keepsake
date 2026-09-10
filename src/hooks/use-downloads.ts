import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { PostResult, ProfileTab } from "@/core/instagram/types";
import { plural } from "@/core/archive/naming";
import {
  downloadFeedZip,
  downloadPostZip,
  downloadProfileZip,
  type ZipOutcome,
} from "@/lib/download/zip";
import type { PagingApi } from "./use-profile-paging";
import type { ResolveApi } from "./use-resolve";

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
export function useDownloads(resolve: ResolveApi, paging: PagingApi) {
  const { profile, resultRef } = resolve;
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

  const downloadTab = useCallback(
    (tab: ProfileTab, posts: PostResult[]) => {
      if (!profile || posts.length === 0) return;
      return guard("feed-tab", "Could not zip those files.", async () => {
        saveToast(await downloadFeedZip(profile.username, tab, posts));
      });
    },
    [guard, profile],
  );

  const downloadProfile = useCallback(() => {
    if (!profile) return;
    return guard("feed-all", "Could not zip that profile.", async () => {
      // "Download everything" has to mean everything. Tabs the search skipped
      // are fetched now -- sequentially, since this is the one place we
      // knowingly touch every endpoint and a burst is what gets us blocked.
      for (const tabId of ["reels", "stories", "highlights"] as ProfileTab[]) {
        await paging.ensureTabLoaded(tabId);
      }
      const current = resultRef.current;
      const full = current && current.ok && current.mode === "profile" ? current.profile : profile;
      const outcome = await downloadProfileZip(full);
      saveToast(outcome, `Packed the public archive (${plural(outcome.saved, "file")})`);
    });
  }, [guard, paging, profile, resultRef]);

  return { busyKey, downloadPost, downloadTab, downloadProfile };
}
