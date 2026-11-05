// CR-117 · ops-watch · check `slo`: đo 4 SLO (contracts.list p95, chat dispatch p50, timer PD-P01, tỷ lệ lỗi log) mỗi lượt, giữ chuỗi vi phạm
// liên tiếp + lịch sử 48 lượt trong `value` (đọc lại qua `prev`), warn/crit theo số lượt liên tiếp (ngưỡng cấu hình trên /system).
// Chuyển trạng thái → chuông như mọi check khác (không thêm cron/đường báo riêng).
import type { OpsStatus } from "@ai/contracts/hub-admin";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import {
  judge,
  nextState,
  parseStates,
  SLO_DEFS,
  type SloDef,
  type SloState,
  summarize,
} from "../../domain/slo.rules";
import { thresholds } from "./check-kit";
import { collectSamples, type SloSamples } from "./slo.sources";

const HINT =
  "Xem /system (giá trị SLO) và log: `docker compose logs --since 30m hub-api | grep -i error`; timer trễ ⇒ kiểm timer-sweep của hub-api; dispatch chậm ⇒ kiểm provider/agent-runtime.";

/** Thuần: trạng thái mới của mọi SLO từ lượt trước + số đo lượt này. */
export function nextStates(
  defs: readonly SloDef[],
  prev: ReadonlyMap<string, SloState>,
  samples: SloSamples,
): SloState[] {
  return defs.map((d) => nextState(d, prev.get(d.id), samples[d.id] ?? null));
}

/** Thuần: kết quả check từ trạng thái mới. */
export function evaluateSlo(
  states: readonly SloState[],
  defs: readonly SloDef[],
  warnN: number,
  critN: number,
): OpsCheckResult {
  const status: OpsStatus = judge(states, defs, warnN, critN);
  const message =
    status === "unknown"
      ? "Chưa có số đo SLO nào (thiếu slo.json / chưa đủ mẫu)"
      : summarize(states, defs, warnN);
  return {
    status,
    value: { slos: states },
    message,
    ...(status === "warn" || status === "crit" ? { hint: HINT } : {}),
  };
}

export const sloCheck: OpsCheck = {
  key: "slo",
  async run(d, cfg) {
    const t = thresholds("slo", cfg);
    const samples = await collectSamples(d);
    const prev = parseStates(d.prev?.slo?.value);
    return evaluateSlo(nextStates(SLO_DEFS, prev, samples), SLO_DEFS, t.warn ?? 2, t.crit ?? 4);
  },
};
