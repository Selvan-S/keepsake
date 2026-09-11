import type { ArchiveEntry } from "@/core/archive/plan";
import { fetchUrl } from "@/lib/media/source";

/**
 * Writing an archive straight into a folder the user picked, instead of zips.
 *
 * Better than zipping in every way that matters here: nothing is held in memory
 * (each file streams to disk), the directory structure is real rather than
 * trapped inside an archive, there is no tap-per-batch because one permission
 * covers every write, and duplicates are detected against what is actually on
 * disk rather than against a list we kept and hope is accurate.
 *
 * The catch is support. `showDirectoryPicker` is Chromium-desktop only — not
 * Firefox, not Safari, and not Android Chrome — so this is an upgrade where
 * available and zip batches remain the fallback. Availability is feature-
 * detected rather than sniffed, because support tables move.
 *
 * This is also the shape the React Native port will use, where writing to the
 * filesystem is simply how saving works.
 */

/** Minimal shape of what we use, so this compiles without DOM lib support. */
type FileSystemWritable = { write(data: Blob): Promise<void>; close(): Promise<void> };
type FileHandle = {
  getFile(): Promise<{ size: number }>;
  createWritable(): Promise<FileSystemWritable>;
};
type DirectoryHandle = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
};

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle>;
};

export function folderModeAvailable(): boolean {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
}

/** Ask for a folder. Returns null if the user dismissed the picker. */
export async function pickFolder(): Promise<DirectoryHandle | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ mode: "readwrite" });
  } catch {
    // The user cancelling the picker throws; that is not an error worth
    // reporting back as one.
    return null;
  }
}

/** Confirm we may still write here — permission can lapse between runs. */
export async function ensureWritable(dir: DirectoryHandle): Promise<boolean> {
  if (!dir.queryPermission || !dir.requestPermission) return true;
  const descriptor = { mode: "readwrite" } as const;
  if ((await dir.queryPermission(descriptor)) === "granted") return true;
  return (await dir.requestPermission(descriptor)) === "granted";
}

/** Walk (creating as needed) to the directory holding `path`, and return the leaf name. */
async function resolvePath(root: DirectoryHandle, path: string): Promise<[DirectoryHandle, string]> {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop() ?? "file";
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return [dir, name];
}

/**
 * Whether this file is already on disk with content.
 *
 * The whole point of folder mode: the filesystem is the truth about what has
 * been archived, so a re-run genuinely skips rather than re-downloading. A
 * zero-byte file counts as absent — that is what a previous run interrupted
 * mid-write leaves behind.
 */
export async function alreadySaved(root: DirectoryHandle, path: string): Promise<boolean> {
  try {
    const [dir, name] = await resolvePath(root, path);
    const handle = await dir.getFileHandle(name, { create: false });
    const file = await handle.getFile();
    return file.size > 0;
  } catch {
    return false;
  }
}

export type FolderWriteResult = { written: number; skipped: number; failed: number };

/**
 * Fetch and write every entry into `root`, skipping what is already there.
 *
 * Sequential on purpose: files land on disk one at a time, so there is no
 * reason to hold several in memory at once, and pacing the CDN is free.
 */
export async function writeEntriesToFolder(
  root: DirectoryHandle,
  entries: ArchiveEntry[],
  options: {
    onProgress?: (done: number, result: FolderWriteResult) => void;
    signal?: AbortSignal;
  } = {},
): Promise<FolderWriteResult> {
  const { onProgress, signal } = options;
  const result: FolderWriteResult = { written: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < entries.length; i += 1) {
    if (signal?.aborted) break;
    const entry = entries[i]!;
    try {
      if (await alreadySaved(root, entry.name)) {
        result.skipped += 1;
        onProgress?.(i + 1, result);
        continue;
      }
      const res = await fetch(fetchUrl(entry.url), {
        signal: AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]),
      });
      if (!res.ok) {
        result.failed += 1;
        onProgress?.(i + 1, result);
        continue;
      }
      const blob = await res.blob();
      const [dir, name] = await resolvePath(root, entry.name);
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      result.written += 1;
    } catch {
      // An expired link or a write error costs one file, not the run.
      result.failed += 1;
    }
    onProgress?.(i + 1, result);
  }
  return result;
}

export type { DirectoryHandle };
