// CR-105 · L1 · design §1–§3: khe `contracts.approval` ("Sổ Hợp Tác · Duyệt hợp đồng"). `slot_body` = `Flow` của gói nhưng phòng
// ban theo MÃ (`department_group_key`, `escalate_group_key`, `company_signer.department_group_key`; `*_group_id` = null) — def thư viện
// dùng chung nhiều tenant không được chứa id Group của tenant nào. Lúc mở lượt: mã ⇒ id theo tenant (`resolveSlotSteps`; thiếu
// mã ⇒ null ⇒ máy cũ), rồi `compileDef` như mẫu tenant. Thuần, lớp 1 (chỉ builtin).
import { compileDef, validateFlow } from "./approval-flow.rules";
import type {
  ApprovalFlowIssue,
  FlowEsignStep,
  FlowReviewStep,
  FlowStep,
} from "./approval-flow.types";

export const APPROVAL_SLOT = "contracts.approval";
export const APPROVAL_SLOT_LABEL = "Sổ Hợp Tác · Duyệt hợp đồng";

type Keyed = { department_group_key?: string | null; escalate_group_key?: string | null };
type SlotSigner = FlowEsignStep["company_signer"] & { department_group_key?: string | null };
export type SlotFlowStep =
  | (FlowReviewStep & Keyed)
  | Extract<FlowStep, { kind: "dify" }>
  | (Omit<FlowEsignStep, "company_signer"> & Keyed & { company_signer: SlotSigner });
export type SlotFlowBody = { steps: SlotFlowStep[] };
export type SlotIssueRule = ApprovalFlowIssue["rule"] | "SLOT_SHAPE" | "GROUP_ID_IN_LIBRARY";

const KINDS = new Set(["review", "dify", "esign"]);
const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Hình tối thiểu (`steps` là mảng bước có `kind` biết); sai ⇒ null. Chi tiết trường: zod ở biên (L2a). */
export function slotBodyOf(x: unknown): SlotFlowBody | null {
  if (!isObj(x) || !Array.isArray(x.steps)) return null;
  const ok = x.steps.every((s) => isObj(s) && KINDS.has(String(s.kind)));
  return ok ? (x as unknown as SlotFlowBody) : null;
}

/** Mã Group mà body tham chiếu (duyệt + chuyển cấp + phòng người ký), không trùng. */
export function slotGroupKeys(body: SlotFlowBody): string[] {
  const keys = new Set<string>();
  for (const s of body.steps) {
    if (s.kind === "dify") continue;
    if (s.escalate_group_key) keys.add(s.escalate_group_key);
    const k = s.kind === "review" ? s.department_group_key : s.company_signer.department_group_key;
    if (k) keys.add(k);
  }
  return [...keys];
}

/** Mã ⇒ id theo tenant (`ids`: mã → id). Mã nào thiếu ⇒ null (Group bị xoá sau khi gán ⇒ lượt chạy máy cũ). */
export function resolveSlotSteps(
  body: SlotFlowBody,
  ids: ReadonlyMap<string, string>,
): FlowStep[] | null {
  let miss = false;
  const id = (k: string | null | undefined): string | null => {
    if (!k) return null;
    const v = ids.get(k);
    if (v === undefined) miss = true;
    return v ?? null;
  };
  const steps = body.steps.map((s): FlowStep => {
    if (s.kind === "dify") return s;
    const { department_group_key: dk, escalate_group_key: ek, ...rest } = s;
    const esc = { escalate_group_id: id(ek) };
    if (rest.kind === "review") return { ...rest, ...esc, department_group_id: id(dk) };
    const { department_group_key: sk, ...signer } = rest.company_signer;
    const dep = { ...signer, department_group_id: id(sk) };
    return { ...rest, ...esc, company_signer: dep };
  });
  return miss ? null : steps;
}

/** `slot_body` thư viện chứa id Group (thay vì mã) — path đầu tiên; null nếu sạch. */
function groupIdPath(body: SlotFlowBody): string | null {
  for (const [i, s] of body.steps.entries()) {
    if (s.kind === "dify") continue;
    if (s.escalate_group_id) return `steps.${i}.escalate_group_id`;
    if (s.kind === "review" && s.department_group_id) return `steps.${i}.department_group_id`;
    if (s.kind === "esign" && s.company_signer.department_group_id)
      return `steps.${i}.company_signer.department_group_id`;
  }
  return null;
}

const identity = (body: SlotFlowBody) => new Map(slotGroupKeys(body).map((k) => [k, k]));

/** `SlotSpec.validate`: hình → không id Group → luật chéo bước của mẫu (`validateFlow`, mã đứng chỗ id). */
export function validateSlotBody(x: unknown): { path: string; rule: SlotIssueRule }[] {
  const body = slotBodyOf(x);
  if (!body) return [{ path: "steps", rule: "SLOT_SHAPE" }];
  const p = groupIdPath(body);
  if (p) return [{ path: p, rule: "GROUP_ID_IN_LIBRARY" }];
  return validateFlow(resolveSlotSteps(body, identity(body)) as FlowStep[]);
}

type Stage = Record<string, unknown> & { after?: Record<string, unknown> };
/** Group id ⇒ mã trên `after` của stage (def thư viện: `group_key`, `escalate.group_key`, `also_group_keys`). */
function keyedAfter(a: Record<string, unknown>): Record<string, unknown> {
  if (a.kind !== "review") return a;
  const { group_id, escalate, also_group_ids, ...rest } = a as Record<string, unknown> & {
    escalate?: { after_h: number; group_id: string } | null;
    also_group_ids?: string[];
  };
  return {
    ...rest,
    group_id: null,
    ...(typeof group_id === "string" ? { group_key: group_id } : {}),
    escalate: escalate ? { after_h: escalate.after_h, group_key: escalate.group_id } : null,
    ...(also_group_ids?.length ? { also_group_keys: also_group_ids } : {}),
  };
}

/** `SlotSpec.compile`: `compileDef` trên mã (mã đứng chỗ id) ⇒ stages def thư viện trỏ Group bằng `*_key`. */
export function compileSlotStages(x: unknown): unknown[] {
  const body = slotBodyOf(x);
  if (!body) throw new Error("approval-slot-shape");
  const steps = resolveSlotSteps(body, identity(body)) as FlowStep[];
  const def = compileDef({ steps }, new Set(slotGroupKeys(body)));
  return (def.stages as Stage[]).map((s) => {
    const out = s.after ? { ...s, after: keyedAfter(s.after) } : s;
    return s.slot ? { ...out, slot: keyedSlot(s.slot as Record<string, unknown>, body) } : out;
  });
}

/**
 * `stage.slot` của def thư viện = bước NGUYÊN của body (mã ở `*_group_key`, `*_group_id` = null) — không phải bước đã "phân giải"
 * mã-đứng-chỗ-id của `compileDef` (review CR-105: canvas/editor đọc `slot` thấy mã nằm sai chỗ). Ký số: `finalize.slot.esign`.
 */
function keyedSlot(slot: Record<string, unknown>, body: SlotFlowBody): Record<string, unknown> {
  const byKey = (k: unknown) => body.steps.find((x) => x.key === k);
  if (slot.esign && typeof slot.esign === "object") {
    const e = byKey((slot.esign as { key?: unknown }).key);
    return e ? { ...slot, esign: { ...e } } : slot;
  }
  const st = byKey(slot.key);
  return st ? { ...st } : slot;
}
