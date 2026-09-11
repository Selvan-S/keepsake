import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ProfileTab } from "@/core/instagram/types";
import { DEFAULT_BUDGET, estimateBatchCount, formatBytes } from "@/core/archive/batch";
import {
  avatarEntry,
  orderedTabs,
  planEntries,
  type ArchiveEntry,
  type ArchiveScope,
} from "@/core/archive/plan";
import { plural } from "@/core/archive/naming";
import { packBatch } from "@/lib/download/pack";
import { shareOrDownload } from "@/lib/download/share";
import {
  ensureWritable,
  folderModeAvailable,
  pickFolder,
  writeEntriesToFolder,
  type DirectoryHandle,
} from "@/lib/download/folder";
import type { PagingApi } from "./use-profile-paging";
import type { ResolveApi } from "./use-resolve";

export type ArchiveStatus =
  | "idle"
  | "writing"
  | "collecting"
  | "packaging"
  | "awaiting"
  | "done"
  | "cancelled"
  | "error";

export type ArchiveState = {
  status: ArchiveStatus;
  /** What the user should be told is happening right now. */
  label: string;
  /** 0..1 once the plan is known; null while still collecting. */
  progress: number | null;
  batchIndex: number;
  estimatedBatches: number;
  filesSaved: number;
  bytesSaved: number;
  failed: number;
  error?: string;
  /** The zip waiting to be taken, when status is "awaiting". */
  pending?: { name: string; files: number; bytes: number };
};

const IDLE: ArchiveState = {
  status: "idle",
  label: "",
  progress: null,
  batchIndex: 0,
  estimatedBatches: 0,
  filesSaved: 0,
  bytesSaved: 0,
  failed: 0,
};

/**
 * Resume state, kept small and free of anything sensitive.
 *
 * Deliberately NOT the entry list: Instagram's CDN URLs are signed and expire
 * within hours, so a job resumed tomorrow that replayed yesterday's URLs would
 * fail every fetch and hand over a corrupt archive while reporting success.
 * Storing shortcodes instead means a resume re-collects and skips what it
 * already has, which is also robust to the feed having changed underneath.
 */
type Persisted = { username: string; tabs: ProfileTab[]; saved: string[] };

const STORAGE_KEY = "keepsake.archive.progress";

function readPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed?.username || !Array.isArray(parsed.saved)) return null;
    return parsed;
  } catch {
    // Private browsing, cleared storage, or a shape from an older build.
    return null;
  }
}

function writePersisted(value: Persisted | null) {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage being unavailable costs resume, not the archive itself.
  }
}

/**
 * Runs an archive: collect what is missing, then hand over zips one at a time.
 *
 * Split into batches because a zip is built entirely in browser memory, and
 * handed over one tap at a time because browsers refuse a run of programmatic
 * downloads. Those two constraints, not request volume, are what shape this.
 *
 * Everything the run reads while it is going lives in refs rather than state.
 * The packing loop is recursive and long-lived, so a value closed over from
 * render would be stale by the second batch — and "stale by the second batch"
 * here means silently re-zipping files or losing the resume list.
 */
export function useArchive(resolve: ResolveApi, paging: PagingApi) {
  const { profile, resultRef } = resolve;
  const [state, setState] = useState<ArchiveState>(IDLE);

  const entriesRef = useRef<ArchiveEntry[]>([]);
  const indexRef = useRef(0);
  const blobRef = useRef<Blob | null>(null);
  const pendingRef = useRef<ArchiveState["pending"]>(undefined);
  const savedRef = useRef<Set<string>>(new Set());
  const scopeRef = useRef<ArchiveScope | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const folderRef = useRef<DirectoryHandle | null>(null);
  const batchRef = useRef(0);
  const failedRef = useRef(0);
  const filesSavedRef = useRef(0);
  const bytesSavedRef = useRef(0);

  const patch = useCallback((next: Partial<ArchiveState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  /** Build and stage the next zip, or finish. */
  const packNext = useCallback(async () => {
    const entries = entriesRef.current;
    const signal = abortRef.current?.signal;

    for (;;) {
      if (signal?.aborted) {
        patch({ status: "cancelled", label: "Archive stopped", pending: undefined });
        return;
      }
      if (indexRef.current >= entries.length) {
        writePersisted(null);
        patch({
          status: "done",
          label: "Archive complete",
          progress: 1,
          pending: undefined,
          failed: failedRef.current,
        });
        return;
      }

      batchRef.current += 1;
      const batchIndex = batchRef.current;
      const remaining = entries.length - indexRef.current;
      patch({ status: "packaging", batchIndex, label: `Packing batch ${batchIndex}…` });

      const name = `${profile?.username ?? "archive"}_part${String(batchIndex).padStart(2, "0")}.zip`;
      let packed;
      try {
        packed = await packBatch(entries, indexRef.current, name, {
          budget: DEFAULT_BUDGET,
          signal,
          onProgress: (filesDone, bytes) => {
            patch({
              label: `Packing batch ${batchIndex} — ${filesDone} of ${remaining} · ${formatBytes(bytes)}`,
            });
          },
        });
      } catch (error) {
        patch({
          status: "error",
          label: "Archive failed",
          error: error instanceof Error ? error.message : "Could not build that archive.",
        });
        return;
      }

      if (signal?.aborted) {
        patch({ status: "cancelled", label: "Archive stopped", pending: undefined });
        return;
      }

      failedRef.current += packed.failed;
      indexRef.current = packed.nextIndex;

      if (packed.files === 0) {
        // Every file in that stretch failed. Move past them and try the next
        // batch rather than looping forever on a run of dead URLs.
        patch({ failed: failedRef.current });
        continue;
      }

      blobRef.current = packed.blob;
      for (const code of packed.savedShortcodes) savedRef.current.add(code);
      pendingRef.current = { name: packed.name, files: packed.files, bytes: packed.bytes };
      patch({
        status: "awaiting",
        label: `Batch ${batchIndex} ready — ${plural(packed.files, "file")}, ${formatBytes(packed.bytes)}`,
        progress: packed.nextIndex / Math.max(1, entries.length),
        pending: pendingRef.current,
        failed: failedRef.current,
      });
      return;
    }
  }, [patch, profile?.username]);

  /** Hand the staged zip to the user, then start the next one. */
  const saveBatch = useCallback(async () => {
    const blob = blobRef.current;
    const pending = pendingRef.current;
    if (!blob || !pending) return;

    const href = URL.createObjectURL(blob);
    try {
      const outcome = await shareOrDownload(blob, pending.name, href);
      // A dismissed share sheet leaves the batch staged, so the user can tap
      // Save again rather than losing the zip that was just built.
      if (outcome === "cancelled") return;

      blobRef.current = null;
      pendingRef.current = undefined;
      filesSavedRef.current += pending.files;
      bytesSavedRef.current += pending.bytes;

      if (profile) {
        writePersisted({
          username: profile.username,
          tabs: scopeRef.current?.tabs ?? [],
          saved: [...savedRef.current],
        });
      }
      patch({
        filesSaved: filesSavedRef.current,
        bytesSaved: bytesSavedRef.current,
        pending: undefined,
      });
      await packNext();
    } finally {
      // Revoked late: the share sheet may still be reading it.
      window.setTimeout(() => URL.revokeObjectURL(href), 15_000);
    }
  }, [packNext, patch, profile]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    blobRef.current = null;
    pendingRef.current = undefined;
    patch({ status: "cancelled", label: "Archive stopped", pending: undefined });
  }, [patch]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    blobRef.current = null;
    pendingRef.current = undefined;
    entriesRef.current = [];
    indexRef.current = 0;
    batchRef.current = 0;
    failedRef.current = 0;
    filesSavedRef.current = 0;
    bytesSavedRef.current = 0;
    savedRef.current = new Set();
    scopeRef.current = null;
    folderRef.current = null;
    setState(IDLE);
  }, []);

  /**
   * Folder mode: no zips, no batches, no tap between them. Files stream to
   * disk one at a time, and anything already there is skipped -- the
   * filesystem is a better record of what has been archived than a list we
   * keep ourselves.
   */
  const writeToFolder = useCallback(
    async (folder: DirectoryHandle, entries: ArchiveEntry[], signal: AbortSignal) => {
      patch({ status: "writing", label: "Saving files…", progress: 0 });
      const outcome = await writeEntriesToFolder(folder, entries, {
        signal,
        onProgress: (done, running) => {
          patch({
            label: `Saving ${done} of ${entries.length}…`,
            progress: done / Math.max(1, entries.length),
            filesSaved: running.written,
            failed: running.failed,
          });
        },
      });
      if (signal.aborted) {
        patch({ status: "cancelled", label: "Archive stopped" });
        return;
      }
      const skipped = outcome.skipped > 0 ? `, ${outcome.skipped} already there` : "";
      patch({
        status: "done",
        progress: 1,
        label: `Saved ${plural(outcome.written, "file")}${skipped}`,
        filesSaved: outcome.written,
        failed: outcome.failed,
      });
    },
    [patch],
  );

  const start = useCallback(
    async (
      scope: ArchiveScope,
      options: { resume?: boolean; toFolder?: boolean } = {},
    ) => {
      if (!profile) return;

      // Ask for the folder before anything else: the picker needs the user
      // gesture that opened the dialog, and a run that collects for a minute
      // first would have lost it.
      let folder: DirectoryHandle | null = null;
      if (options.toFolder) {
        folder = await pickFolder();
        if (!folder) return;
        if (!(await ensureWritable(folder))) {
          toast.error("Keepsake needs permission to write to that folder.");
          return;
        }
      }

      const previous = options.resume ? readPersisted() : null;
      const carried =
        previous && previous.username === profile.username ? new Set(previous.saved) : new Set<string>();

      reset();
      const controller = new AbortController();
      abortRef.current = controller;
      scopeRef.current = scope;
      savedRef.current = carried;
      folderRef.current = folder;
      setState({ ...IDLE, status: "collecting", label: "Working out what to fetch…" });

      // 1. Collect. The selection path skips this entirely -- those posts are
      //    already in memory, which is what makes it the fast path.
      if (!scope.only) {
        for (const tab of orderedTabs(scope.tabs)) {
          if (controller.signal.aborted) return;
          await paging.collectTab(
            tab,
            scope.perTabLimit,
            (loaded) => patch({ label: `Finding ${tab}… ${loaded} so far` }),
            controller.signal,
          );
        }
      }
      if (controller.signal.aborted) {
        patch({ status: "cancelled", label: "Archive stopped" });
        return;
      }

      // 2. Plan against the freshly-collected profile, not the snapshot this
      //    callback closed over before paging started.
      const latest = resultRef.current;
      const source = latest && latest.ok && latest.mode === "profile" ? latest.profile : profile;
      const entries = planEntries(source, scope, { alreadySaved: savedRef.current });
      // The avatar is worth one file, but not worth re-fetching on every resume.
      const avatar = carried.size === 0 ? avatarEntry(source) : null;
      entriesRef.current = avatar ? [avatar, ...entries] : entries;
      indexRef.current = 0;

      if (entriesRef.current.length === 0) {
        patch({
          status: "done",
          label: carried.size > 0 ? "Nothing new left to archive" : "Nothing to archive",
          progress: 1,
        });
        return;
      }

      if (folderRef.current) {
        await writeToFolder(folderRef.current, entriesRef.current, controller.signal);
        return;
      }

      patch({ estimatedBatches: estimateBatchCount(entriesRef.current.length), progress: 0 });
      await packNext();
    },
    [packNext, paging, patch, profile, reset, resultRef, writeToFolder],
  );

  /** A previous run for this profile that stopped part-way, if any. */
  const resumable = useCallback((): Persisted | null => {
    const previous = readPersisted();
    if (!previous || !profile || previous.username !== profile.username) return null;
    return previous.saved.length > 0 ? previous : null;
  }, [profile]);

  const discardResume = useCallback(() => {
    writePersisted(null);
    toast.success("Cleared the saved archive progress.");
  }, []);

  return {
    state,
    start,
    saveBatch,
    cancel,
    reset,
    resumable,
    discardResume,
    folderModeAvailable: folderModeAvailable(),
  };
}

export type ArchiveApi = ReturnType<typeof useArchive>;
