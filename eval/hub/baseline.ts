// CR-114 hub-eval · điểm chuẩn + so sánh hồi quy + bản tóm tắt ≤ 10 dòng (thuần).
import { round } from "./grade";
import type { Baseline, Report } from "./types";

export const DEFAULT_THRESHOLD = 0.05;

export function toBaseline(rep: Report): Baseline {
  const cases: Baseline["cases"] = {};
  for (const r of rep.results) cases[r.id] = { score: r.score, pass: r.pass };
  return { version: 1, overall: rep.overall, agents: rep.agents, cases };
}

export type Diff = {
  overallDelta: number;
  agentDeltas: Record<string, number>;
  /** Agent mất điểm quá ngưỡng. */
  regressedAgents: string[];
  /** Ca đạt ở baseline nhưng trượt nay. */
  flippedCases: string[];
  /** Ca baseline có mà lần chạy này không có (bị lọc / xoá): chỉ báo, không tính hồi quy. */
  missingCases: string[];
  regression: boolean;
};

export function diffBaseline(rep: Report, base: Baseline, threshold = DEFAULT_THRESHOLD): Diff {
  const agentDeltas: Record<string, number> = {};
  const regressedAgents: string[] = [];
  for (const [a, s] of Object.entries(rep.agents)) {
    const b = base.agents[a];
    if (b === undefined) continue; // agent mới: chưa có chuẩn
    const d = round(s - b);
    agentDeltas[a] = d;
    // so với ngưỡng bằng epsilon để 0.05 đúng bằng ngưỡng không bị coi là vượt do sai số số thực
    if (-d > threshold + 1e-9) regressedAgents.push(a);
  }
  const ran = new Set(rep.results.map((r) => r.id));
  const flippedCases = rep.results
    .filter((r) => !r.pass && base.cases[r.id]?.pass)
    .map((r) => r.id);
  const missingCases = Object.keys(base.cases).filter((id) => !ran.has(id));
  // chạy có `--filter` thì overall không so sánh được với baseline đầy đủ: chỉ so khi đủ ca
  const full = missingCases.length === 0;
  const overallDelta = full ? round(rep.overall - base.overall) : 0;
  const overallDrop = full && -overallDelta > threshold + 1e-9;
  return {
    overallDelta,
    agentDeltas,
    regressedAgents,
    flippedCases,
    missingCases,
    regression: regressedAgents.length > 0 || overallDrop,
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const signed = (n: number): string => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}`;

/** Tóm tắt ≤ 10 dòng. */
export function summarize(rep: Report, diff?: Diff, costNote?: string): string {
  const failed = rep.results.filter((r) => !r.pass);
  const tail: string[] = [];
  if (failed.length) tail.push(failedLine(failed.map((r) => r.id)));
  if (diff) tail.push(verdictLine(diff));
  if (costNote) tail.push(`  ${costNote}`);
  const head =
    `eval:hub ${rep.mode} · ${rep.results.length} ca · ${rep.results.length - failed.length} đạt · điểm ${pct(rep.overall)}` +
    (diff ? ` (${signed(diff.overallDelta)}pp vs baseline)` : "");
  const agentLines = Object.entries(rep.agents)
    .slice(0, 10 - 1 - tail.length)
    .map(([a, s]) => agentLine(a, s, diff));
  return [head, ...agentLines, ...tail].join("\n");
}

function agentLine(a: string, s: number, diff?: Diff): string {
  const d = diff?.agentDeltas[a];
  const delta = d === undefined ? "" : ` (${signed(d)}pp)`;
  const flag = diff?.regressedAgents.includes(a) ? "  HỒI QUY" : "";
  return `  ${a.padEnd(14)} ${pct(s).padStart(6)}${delta}${flag}`;
}

function failedLine(ids: string[]): string {
  return `  trượt: ${ids.slice(0, 4).join(", ")}${ids.length > 4 ? ` +${ids.length - 4}` : ""}`;
}

function verdictLine(diff: Diff): string {
  if (diff.regression) {
    const flipped = diff.flippedCases.slice(0, 3).join(", ");
    return `  KẾT QUẢ: hồi quy${flipped ? ` (ca đạt→trượt: ${flipped})` : ""}`;
  }
  const skipped = diff.missingCases.length;
  return `  KẾT QUẢ: không hồi quy${skipped ? ` (bỏ qua ${skipped} ca ngoài bộ lọc)` : ""}`;
}
