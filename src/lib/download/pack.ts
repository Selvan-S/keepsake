import type { ArchiveEntry } from "@/core/archive/plan";
import { BatchAccumulator, DEFAULT_BUDGET, type BatchBudget } from "@/core/archive/batch";
import { fetchUrl } from "@/lib/media/source";

/** Per-file ceiling so one stalled CDN response cannot hang a whole archive. */
const MEDIA_TIMEOUT_MS = 45_000;

/**
 * How many files are fetched at once.
 *
 * Small on purpose. The budget can only be checked between waves, so a wide
 * wave overshoots the memory limit by more — and the point of the limit is that
 * the tab does not run out of memory.
 */
const WAVE = 4;

export type PackedBatch = {
  blob: Blob;
  name: string;
  files: number;
  bytes: number;
  /** Posts fully or partly written, so a resumed run can skip them. */
  savedShortcodes: string[];
  /** Where the next batch starts. Equal to the entry count when finished. */
  nextIndex: number;
  failed: number;
};

export type PackOptions = {
  budget?: BatchBudget;
  onProgress?: (filesDone: number, bytes: number) => void;
  signal?: AbortSignal;
};

/**
 * Build one zip, starting at `startIndex`, stopping when the budget is spent.
 *
 * Returns where to resume rather than looping over everything, because each
 * zip has to be handed to the user separately: browsers refuse a run of
 * programmatic downloads, so the caller pauses for a tap between batches.
 */
export async function packBatch(
  entries: ArchiveEntry[],
  startIndex: number,
  name: string,
  options: PackOptions = {},
): Promise<PackedBatch> {
  const { budget = DEFAULT_BUDGET, onProgress, signal } = options;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const acc = new BatchAccumulator(budget);
  const savedShortcodes = new Set<string>();
  let failed = 0;
  let index = startIndex;

  while (index < entries.length && !acc.isFull) {
    if (signal?.aborted) break;
    const wave = entries.slice(index, index + WAVE);
    const results = await Promise.all(
      wave.map(async (entry) => {
        // One expired or unreachable CDN URL must not abort the archive, so
        // every failure is counted and reported rather than thrown or, worse,
        // dropped silently into a zip the caller then calls a success.
        try {
          const res = await fetch(fetchUrl(entry.url), {
            signal: AbortSignal.any([
              AbortSignal.timeout(MEDIA_TIMEOUT_MS),
              ...(signal ? [signal] : []),
            ]),
          });
          if (!res.ok) return null;
          return { entry, blob: await res.blob() };
        } catch {
          return null;
        }
      }),
    );

    for (const result of results) {
      if (!result) {
        failed += 1;
        continue;
      }
      zip.file(result.entry.name, result.blob);
      // blob.size is the real size; content-length is often absent through the
      // proxy, and a wrong size here is what would blow the memory budget.
      acc.add(result.blob.size);
      savedShortcodes.add(result.entry.shortcode);
    }
    index += wave.length;
    onProgress?.(index - startIndex, acc.byteCount);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return {
    blob,
    name,
    files: acc.fileCount,
    bytes: acc.byteCount,
    savedShortcodes: [...savedShortcodes],
    nextIndex: index,
    failed,
  };
}
