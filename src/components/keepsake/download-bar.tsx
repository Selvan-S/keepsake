import { Download, LoaderCircle } from "lucide-react";
import type { ProfileResult, ProfileTab } from "@/core/instagram/types";
import { Button } from "@/components/ui/button";

export function DownloadBar({
  profile,
  tab,
  onSaveTab,
  onSaveProfile,
  savingTab,
  savingProfile,
  archiveCount,
}: {
  profile: ProfileResult;
  tab: ProfileTab;
  onSaveTab: () => void;
  onSaveProfile: () => void;
  savingTab: boolean;
  savingProfile: boolean;
  archiveCount: number;
}) {
  const feed = profile[tab];
  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <Button
        type="button"
        size="lg"
        className="h-11 flex-1"
        onClick={onSaveProfile}
        disabled={savingProfile || archiveCount === 0}
      >
        {savingProfile ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
        Save profile
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="h-11 flex-1"
        onClick={onSaveTab}
        disabled={savingTab || feed.items.length === 0}
      >
        {savingTab ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
        Save {tab}
      </Button>
    </div>
  );
}
