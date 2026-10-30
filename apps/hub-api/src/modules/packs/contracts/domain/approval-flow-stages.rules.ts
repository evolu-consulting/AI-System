// CR-105 · pl-slot-shape · khe `contracts.approval`: nghịch `compileDef` (stages canvas ⇒ mẫu `Flow`) + kiểm dạng tuần tự + xem
// trước đường đi theo (loại HĐ, giá trị). Luật thuần (lớp 1). Dạng song song / If / nhánh ⇒ `SLOT_SHAPE_UNSUPPORTED` (422).

import {
  engineStepOf,
  FINALIZE_STAGE,
  FLOW_TOOL_KEYS,
  ROUTE_STAGE,
  stageKeyOf,
  stepApplies,
} from "./approval-flow.rules";
import type { FlowDeal, FlowEsignStep, FlowStep } from "./approval-flow.types";

export const SLOT_SHAPE_UNSUPPORTED = "SLOT_SHAPE_UNSUPPORTED";

/** Phần của stage def mà `fromStages` đọc (stage đầy đủ của engine có nhiều trường hơn). */
export type StageLike = {
  key: string;
  name?: string;
  step: number;
  executor: { kind: string; tool_key?: string };
  slot?: Record<string, unknown> | undefined;
};

export type FromStagesResult =
  | { ok: true; steps: FlowStep[] }
  | { ok: false; error: typeof SLOT_SHAPE_UNSUPPORTED; stage: string };

const bad = (stage: string): FromStagesResult => ({
  ok: false,
  error: SLOT_SHAPE_UNSUPPORTED,
  stage,
});

const isTool = (s: StageLike, tool: string) =>
  s.executor.kind === "tool" && s.executor.tool_key === tool;

/**
 * Nghịch `compileDef`: nhận đúng chuỗi `s0 → route → s1..sn → finalize` (mỗi bước một stage, `step` đúng `engineStepOf`),
 * `stage.slot` mang bước (review/Dify, gồm `when`), `finalize.slot.esign` mang bước Ký số đuôi. Khác (hai stage cùng bước =
 * song song, If, thiếu/đổi route/finalize, stage không có `slot`) ⇒ lỗi kèm khoá stage đầu tiên sai dạng.
 */
export function fromStages(stages: readonly StageLike[]): FromStagesResult {
  const [first, route, ...tail] = stages;
  const finalize = tail.pop();
  if (!first || !route || !finalize) return bad(stages[0]?.key ?? "");
  if (route.key !== ROUTE_STAGE || route.step !== 1 || !isTool(route, FLOW_TOOL_KEYS.route))
    return bad(route.key);
  const user = [first, ...tail];
  const steps: FlowStep[] = [];
  for (const [i, st] of user.entries()) {
    const step = userStepOf(st, i);
    if (!step) return bad(st.key);
    steps.push(step);
  }
  if (!finalizeOk(finalize, user.length)) return bad(finalize.key);
  const esign = finalize.slot?.esign;
  if (esign !== undefined) {
    if (typeof esign !== "object" || esign === null) return bad(finalize.key);
    steps.push(esign as FlowEsignStep);
  }
  return { ok: true, steps };
}

/** Stage `i` (bước người dùng) ⇒ bước; sai khoá / bước engine / thiếu `slot` / không phải review|Dify ⇒ null. */
function userStepOf(st: StageLike, i: number): FlowStep | null {
  const slot = st.slot;
  const kind = slot?.kind;
  if (!slot || st.key !== stageKeyOf(i) || st.step !== engineStepOf(i)) return null;
  if (kind !== "review" && kind !== "dify") return null;
  if (kind === "review" && !isTool(st, FLOW_TOOL_KEYS.route)) return null;
  return { ...slot, key: slot.key ?? st.key, name: st.name ?? slot.name } as FlowStep;
}

const finalizeOk = (f: StageLike, n: number) =>
  f.key === FINALIZE_STAGE && f.step === engineStepOf(n) && isTool(f, FLOW_TOOL_KEYS.finalize);

export type PreviewStep = { index: number; key: string; kind: FlowStep["kind"]; run: boolean };

/**
 * Xem trước: với (loại HĐ, giá trị) bước nào chạy / bị bỏ qua. Bước đầu luôn chạy, Dify luôn chạy, review theo `when` (trống
 * ⇒ chạy, như `condHolds`), bước Ký số (đuôi) luôn chạy.
 */
export function previewPath(
  flow: { steps: readonly FlowStep[] },
  input: { contractType: FlowDeal | null; value: unknown },
): PreviewStep[] {
  const facts = { deal: input.contractType, total_value: input.value };
  return flow.steps.map((s, i) => ({
    index: i,
    key: s.key,
    kind: s.kind,
    run: i === 0 || s.kind === "esign" || stepApplies(s, facts),
  }));
}
