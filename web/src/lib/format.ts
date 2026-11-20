export { pct, signedPct } from "toolgrade/core";

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  if (v === 0) return "$0";
  return v < 0.01
    ? `$${v.toFixed(4)}`
    : v < 100
      ? `$${v.toFixed(2)}`
      : `$${Math.round(v).toLocaleString("en-US")}`;
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "-";
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function timeAgo(date: Date, now = new Date()): string {
  const s = Math.round((date.getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS)
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  return "just now";
}

export function shortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ms(v: number): string {
  return v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
}

/** Relative % change (not percentage points, unlike signedPct): +20% means "20% more", fitting for
 * a cost or latency delta rather than a rate difference. Mirrors src/report.ts's signedRelPct so
 * the hosted app and the CLI's terminal/markdown reports read the same way. */
export function signedRelPct(x: number): string {
  return `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
