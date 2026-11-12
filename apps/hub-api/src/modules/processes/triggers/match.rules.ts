// CR-122 · E1 · ADR-0038 · FLOW2-FR-03/20 · luật THUẦN chọn flow cho một sự kiện: điều kiện Bắt đầu khi trên dữ kiện lúc sự kiện,
// "chạy mọi flow đang bật khớp", sự kiện `decides` ⇒ chỉ flow khớp ĐẦU TIÊN theo `position` (H1), flow khác ghi lý do.
import type { FactCond, FactWhen } from "@ai/contracts/hub-admin";
import { scheduleDaysMatch } from "./schedule.rules";

export type FactsIn = Readonly<Record<string, unknown>>;

/** Một flow đang bật của công ty có `trigger_event` = sự kiện (đã sắp theo `position`, rồi `id`). */
export type FlowCandidate = {
  companyFlowId: string;
  flowId: string;
  defKey: string;
  position: number;
  when: FactWhen | null;
  /** CR-127 E6 · R#12 · N của flow theo lịch (`trigger.params.days` hoặc mặc định manifest); null/vắng = sự kiện không theo lịch. */
  days?: number | null;
};

export type SkipReason = "not_matched" | "decided_by_earlier";
export type EventPlan<C extends FlowCandidate = FlowCandidate> = {
  run: C[];
  skipped: { companyFlowId: string; reason: SkipReason; by?: string }[];
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function order(v: unknown, x: unknown): number | null {
  if (isNum(v) && isNum(x)) return v - x;
  if (typeof v === "string" && typeof x === "string") return v < x ? -1 : v > x ? 1 : 0;
  return null;
}

function eq(v: unknown, x: unknown): boolean {
  if (Array.isArray(v)) return v.some((e) => e === x);
  return v === x;
}

/** Trường trống (vắng/null/"") ⇒ không khớp (như node Nếu: "chưa có dữ liệu" ⇒ Sai). `department` = mảng mã Group. */
export function condHolds(c: FactCond, facts: FactsIn): boolean {
  const v = facts[c.fact];
  if (v === undefined || v === null || v === "") return false;
  const x = c.value;
  if (c.op === "in") {
    if (!Array.isArray(x)) return false;
    return Array.isArray(v) ? v.some((e) => x.includes(e as string)) : x.includes(v as string);
  }
  if (c.op === "eq") return eq(v, x);
  if (c.op === "ne") return !eq(v, x);
  const d = order(v, x);
  if (d === null) return false;
  if (c.op === "lt") return d < 0;
  if (c.op === "le") return d <= 0;
  if (c.op === "gt") return d > 0;
  return d >= 0;
}

export function whenHolds(w: FactWhen | null | undefined, facts: FactsIn): boolean {
  if (!w) return true;
  const one = (c: FactWhen["conds"][number]): boolean =>
    "fact" in c
      ? condHolds(c, facts)
      : c.op === "and"
        ? c.conds.every((g) => condHolds(g, facts))
        : c.conds.some((g) => condHolds(g, facts));
  return w.op === "and" ? w.conds.every(one) : w.conds.some(one);
}

/** Kế hoạch cho một sự kiện: `candidates` PHẢI đã sắp theo `position` (SQL `order by`). */
export function planEvent<C extends FlowCandidate>(
  candidates: readonly C[],
  facts: FactsIn,
  decides: boolean,
): EventPlan<C> {
  const plan: EventPlan<C> = { run: [], skipped: [] };
  for (const c of candidates) {
    if (!scheduleDaysMatch(c.days, facts.days) || !whenHolds(c.when, facts)) {
      plan.skipped.push({ companyFlowId: c.companyFlowId, reason: "not_matched" });
      continue;
    }
    const first = plan.run[0];
    if (decides && first) {
      plan.skipped.push({
        companyFlowId: c.companyFlowId,
        reason: "decided_by_earlier",
        by: first.companyFlowId,
      });
      continue;
    }
    plan.run.push(c);
  }
  return plan;
}

/** Thử lại tối đa 5 lần (readiness Q3); lùi 30 s · 2^(n-1), trần 30 phút. */
export const FLOW_EVENT_ATTEMPTS_MAX = 5;
export const retryDelayMs = (attempts: number): number =>
  Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
