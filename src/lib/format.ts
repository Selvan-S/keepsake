/** Display formatting. Pure, and independent of any component. */

export function formatCount(n: number): string {
  // Logged-out requests often carry no counts at all; an empty string lets the
  // caller drop the stat rather than print a misleading zero.
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

export function formatDate(ts: number | null): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts * 1000));
}
