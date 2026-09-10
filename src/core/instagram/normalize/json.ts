/**
 * Defensive readers for Instagram's GraphQL JSON. Every field is optional in
 * practice: shapes differ between endpoints and change without notice, so
 * nothing here throws — a missing or wrongly-typed field becomes its fallback
 * and the caller decides whether the result is usable.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
