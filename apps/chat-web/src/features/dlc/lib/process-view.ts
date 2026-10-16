// DLC-R12 · (thuần) màu và số liệu hiển thị của node Process.
import type { DlcNode } from "@ai/contracts/chat";

export const NODE_TONE: Record<DlcNode["state"], { dot: string; badge: string }> = {
  done: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  running: {
    dot: "bg-blue-500 animate-pulse",
    badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
  paused: { dot: "bg-amber-500", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  failed: { dot: "bg-red-500", badge: "bg-red-500/15 text-red-700 dark:text-red-300" },
  pending: { dot: "bg-slate-400", badge: "bg-muted text-muted-foreground" },
  skipped: { dot: "bg-slate-400", badge: "bg-muted text-muted-foreground" },
};

/** Chấm màu trạng thái run ở sidebar. */
export function runStateTone(state: string): string {
  if (state === "green") return "bg-emerald-500";
  if (state === "escalated") return "bg-red-500";
  if (state === "parked") return "bg-amber-500";
  return "bg-blue-500 animate-pulse";
}

export const formatUsd = (usd: number): string =>
  `$${usd
    .toFixed(usd >= 1 ? 2 : 4)
    .replace(/0+$/, "")
    .replace(/\.$/, "")}`;

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export type ProcessTotals = { calls: number; usd: number; tokens: number };

export function totalsOf(nodes: readonly DlcNode[]): ProcessTotals {
  return nodes.reduce(
    (t, n) => ({
      calls: t.calls + n.llm_calls,
      usd: t.usd + n.usd,
      tokens: t.tokens + n.tokens_in + n.tokens_out,
    }),
    { calls: 0, usd: 0, tokens: 0 },
  );
}
