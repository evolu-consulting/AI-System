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
import type {
  FlowCond,
  FlowCondGroup,
  FlowDeal,
  FlowEsignStep,
  FlowStep,
  FlowWhen,
} from "./approval-flow.types";
import { condHasData, type FlowFacts } from "./approval-flow-cond.rules";
import { validateSlotBody } from "./approval-slot.rules";
import { APPROVAL_SLOT_FIELDS, APPROVAL_SLOT_NODES } from "./approval-slot-catalog.rules";

export const SLOT_SHAPE_UNSUPPORTED = "SLOT_SHAPE_UNSUPPORTED";

/** Phần của stage def mà `fromStages` đọc (stage đầy đủ của engine có nhiều trường hơn). */
export type StageLike = {
  key: string;
  name?: string;
  step: number;
  executor: { kind: string; tool_key?: string };
  slot?: Record<string, unknown> | undefined;
  /** CR-122 · M1 · node Kết thúc của FlowDef (backfill thêm vào đuôi `stages` của def khe) — không thuộc dạng khe. */
  outcome?: string | undefined;
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
export function fromStages(all: readonly StageLike[]): FromStagesResult {
  // CR-122 · M1: def khe đã backfill có thêm node Kết thúc (`outcome`) sau `finalize` — bỏ đi, dạng khe không đổi.
  const stages = all.at(-1)?.outcome !== undefined ? all.slice(0, -1) : all;
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
  // CR-121 D-6 · bước Thông báo / Chờ tới: stage engine cùng loại (`notify` / `wait_until`).
  const auto = kind === "notify" || kind === "wait_until";
  if (kind !== "review" && kind !== "dify" && !auto) return null;
  if (kind === "review" && !isTool(st, FLOW_TOOL_KEYS.route)) return null;
  if (auto && st.executor.kind !== kind) return null;
  return { ...slot, key: slot.key ?? st.key, name: st.name ?? slot.name } as FlowStep;
}

const finalizeOk = (f: StageLike, n: number) =>
  f.key === FINALIZE_STAGE && f.step === engineStepOf(n) && isTool(f, FLOW_TOOL_KEYS.finalize);

/** `no_data`: bước có điều kiện mà dữ kiện của điều kiện còn trống ⇒ vẫn chạy (an toàn) nhưng ghi "chưa có dữ liệu". */
export type PreviewState = "run" | "skip" | "no_data";
export type PreviewStep = {
  index: number;
  key: string;
  kind: FlowStep["kind"];
  run: boolean;
  state: PreviewState;
};
export type PreviewInput = {
  contractType: FlowDeal | null;
  value: unknown;
  /** CR-121 D-2 · mã phòng ban người gửi duyệt (đã gồm phòng cha — như dữ kiện lúc rẽ thật). */
  creatorDepartments?: readonly string[] | null | undefined;
  newPartner?: boolean | null | undefined;
};

const condLeaves = (w: FlowWhen | FlowCondGroup): FlowCond[] =>
  w.conds.flatMap((c) => ("field" in c ? [c] : condLeaves(c)));

/** Bước có điều kiện thiếu dữ liệu của ít nhất một điều kiện lá. */
const whenMissingData = (s: FlowStep, f: FlowFacts): boolean =>
  s.kind === "review" && s.when !== null && condLeaves(s.when).some((c) => !condHasData(c, f));

/**
 * Xem trước: với dữ kiện mẫu (loại HĐ, giá trị, phòng ban người gửi, đối tác mới) bước nào chạy / bị bỏ qua / chưa có dữ liệu. Bước
 * đầu luôn chạy, Dify luôn chạy, review theo `when` (dữ liệu trống ⇒ chạy, như `condHolds`), bước Ký số (đuôi) luôn chạy.
 */
export function previewPath(
  flow: { steps: readonly FlowStep[] },
  input: PreviewInput,
): PreviewStep[] {
  const facts: FlowFacts = {
    deal: input.contractType,
    total_value: input.value,
    creator_departments: input.creatorDepartments,
    new_partner: input.newPartner,
  };
  return flow.steps.map((s, i) => {
    const run = i === 0 || s.kind === "esign" || stepApplies(s, facts);
    const state: PreviewState = !run ? "skip" : whenMissingData(s, facts) ? "no_data" : "run";
    return { index: i, key: s.key, kind: s.kind, run, state };
  });
}

/** Mã phòng ban dùng trong điều kiện `creator_department` của body (kiểm tồn tại ở tenant khi gán). */
export function conditionDepartmentKeys(steps: readonly FlowStep[]): string[] {
  const leaves = steps.flatMap((s) => (s.kind === "review" && s.when ? condLeaves(s.when) : []));
  return [...new Set(leaves.flatMap((c) => (c.field === "creator_department" ? c.in : [])))];
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const FIELDS = new Map<string, (typeof APPROVAL_SLOT_FIELDS)[number]>(
  APPROVAL_SLOT_FIELDS.map((f) => [f.key, f]),
);
const NODE_KINDS = new Set<string>(APPROVAL_SLOT_NODES.map((n) => n.kind));

/** Một điều kiện lá so với danh mục trường của khe: trường chưa khai / toán tử sai / giá trị ngoài danh sách. */
function leafIssue(c: unknown): string | null {
  if (!isObj(c)) return "COND_FIELD_UNDECLARED";
  const f = FIELDS.get(String(c.field));
  if (!f) return "COND_FIELD_UNDECLARED";
  if (f.type === "boolean") return typeof c.is === "boolean" ? null : "COND_VALUE_INVALID";
  if (f.type === "number")
    return (f.ops as readonly string[]).includes(String(c.op)) && typeof c.value === "number"
      ? null
      : "COND_OP_UNSUPPORTED";
  const vals = Array.isArray(c.in) ? c.in : null;
  if (!vals || vals.length === 0) return "COND_VALUE_INVALID";
  return f.type === "enum" && !enumOk(f, vals) ? "COND_VALUE_INVALID" : null;
}

function enumOk(f: (typeof APPROVAL_SLOT_FIELDS)[number], vals: unknown[]): boolean {
  if (!("options" in f)) return true;
  const ok = new Set<string>(f.options.map((o) => o.value));
  return vals.every((v) => ok.has(String(v)));
}

/** Lỗi điều kiện của một bước (`steps.i.when`): lá sai danh mục; nhóm lồng sâu hơn một cấp. */
function whenIssues(conds: unknown[], path: string, depth = 0): { path: string; rule: string }[] {
  return conds.flatMap((c) => {
    if (isObj(c) && Array.isArray(c.conds))
      return depth === 0 ? whenIssues(c.conds, path, 1) : [{ path, rule: "COND_NESTING" }];
    const r = leafIssue(c);
    return r ? [{ path, rule: `${r}:${String((c as { field?: unknown })?.field)}` }] : [];
  });
}

/** Luật khe thêm vào `validateSlotBody` (path `steps.i.kind` / `steps.i.when`; rule = mã cho câu sửa tiếng Việt). */
export function stepKindAndCondIssues(body: unknown): { path: string; rule: string }[] {
  if (!isObj(body) || !Array.isArray(body.steps)) return [];
  const out: { path: string; rule: string }[] = [];
  body.steps.forEach((s, i) => {
    if (!isObj(s)) return;
    if (!NODE_KINDS.has(String(s.kind)))
      out.push({ path: `steps.${i}.kind`, rule: "NODE_UNSUPPORTED" });
    const w = s.when;
    if (isObj(w) && Array.isArray(w.conds)) out.push(...whenIssues(w.conds, `steps.${i}.when`));
  });
  return out;
}

/** `SlotSpec.validate` của khe duyệt HĐ: loại bước + điều kiện (khai báo) trước, rồi hình + luật chéo bước. */
export function validateApprovalBody(body: unknown): { path: string; rule: string }[] {
  const extra = stepKindAndCondIssues(body);
  return extra.length ? extra : validateSlotBody(body);
}
