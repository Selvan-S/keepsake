/**
 * Splitting an archive into batches the device can actually survive.
 *
 * A zip is assembled entirely in memory, so the limit that matters is bytes,
 * not files: 100 photos is tens of megabytes, 100 reels is close to a gigabyte.
 * Batching by count alone is how a phone runs out of memory mid-archive.
 *
 * Sizes are not known until each file arrives — Instagram's URLs carry no size
 * — so a batch is closed *while* it is being packed rather than planned exactly
 * in advance. That is why this is an accumulator rather than a split function,
 * and why any batch count shown before packing is an estimate.
 */

export type BatchBudget = {
  maxFiles: number;
  maxBytes: number;
};

export const DEFAULT_BUDGET: BatchBudget = {
  maxFiles: 100,
  // Deliberately conservative: this has to hold in a phone browser tab, not on
  // a desktop. Tune against a real run before raising it.
  maxBytes: 200 * 1024 * 1024,
};

/** Tracks one batch as it fills. */
export class BatchAccumulator {
  private files = 0;
  private bytes = 0;
  private readonly budget: BatchBudget;

  // Assigned explicitly rather than as a constructor parameter property: the
  // test runner strips types without transforming, and parameter properties
  // need a transform.
  constructor(budget: BatchBudget = DEFAULT_BUDGET) {
    this.budget = budget;
  }

  get fileCount(): number {
    return this.files;
  }

  get byteCount(): number {
    return this.bytes;
  }

  get isEmpty(): boolean {
    return this.files === 0;
  }

  /**
   * Whether this batch has hit either limit and should be closed.
   *
   * Checked *after* adding, because a media URL carries no size: the only way
   * to learn how big a file is, is to download it. A batch can therefore
   * overshoot `maxBytes` by up to one file, which is inherent rather than a
   * bug — the budget has to leave room for that.
   */
  get isFull(): boolean {
    return this.files >= this.budget.maxFiles || this.bytes >= this.budget.maxBytes;
  }

  /**
   * Whether this batch can take one more file of a *known* size.
   *
   * An empty batch always accepts, however large the file: a single 300 MB
   * video must still be archivable, and refusing it would stall the run
   * forever rather than producing an oversized batch of one.
   */
  accepts(bytes: number): boolean {
    if (this.files === 0) return true;
    if (this.files + 1 > this.budget.maxFiles) return false;
    if (this.bytes + bytes > this.budget.maxBytes) return false;
    return true;
  }

  add(bytes: number): void {
    this.files += 1;
    // A missing or unparseable content-length arrives as NaN, and NaN would
    // poison the running total permanently -- every later `accepts` would be
    // false and the run would stall producing one-file batches. Count the file,
    // ignore the unknown size.
    this.bytes += Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  }

  reset(): void {
    this.files = 0;
    this.bytes = 0;
  }
}

/**
 * A pre-flight guess at batch count, from the file count alone.
 *
 * Only ever a lower bound: it cannot see sizes, so a run of videos will split
 * into more batches than this. Label it as an estimate wherever it is shown.
 */
export function estimateBatchCount(entryCount: number, budget: BatchBudget = DEFAULT_BUDGET): number {
  if (entryCount <= 0) return 0;
  return Math.ceil(entryCount / budget.maxFiles);
}

/** Bytes as something a person can read. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
