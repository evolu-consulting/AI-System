// CR-105 · L2a · design §1/§6: quy trình mặc định của khe `contracts.approval` (seed hub 0069) + đổi mẫu tenant cũ (Group theo id)
// sang `slot_body` theo MÃ cho script chuyển dữ liệu. Thuần, lớp 1.
import { APPROVAL_DEFAULTS, type ApprovalSettings } from "./approval-def.rules";
import { defaultFlowFromSettings } from "./approval-flow.rules";
import type { FlowStep } from "./approval-flow.types";
import { fromStages, type StageLike } from "./approval-flow-stages.rules";
import type { SlotFlowBody, SlotFlowStep } from "./approval-slot.rules";

/** Def mặc định seed ở hub 0069 (id cố định ⇒ migration chạy lại vô hại). */
export const APPROVAL_DEFAULT_DEF = {
  id: "0c105000-0000-4000-8000-000000000069",
  key: "hd-mac-dinh",
  name: "Quy trình HĐ mặc định",
} as const;

type KeyOf = (id: string) => string | undefined;

/** Mẫu theo id ⇒ body theo mã; id không còn mã ⇒ `missing` (script dừng tenant đó). `approver_user_id`/người ký giữ id. */
export function keyedSlotBody(
  steps: readonly FlowStep[],
  keyOf: KeyOf,
): { body: SlotFlowBody } | { missing: string[] } {
  const missing = new Set<string>();
  const k = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const v = keyOf(id);
    if (v === undefined) missing.add(id);
    return v ?? null;
  };
  const out = steps.map((s): SlotFlowStep => {
    if (s.kind === "dify") return { ...s };
    const esc = { escalate_group_id: null, escalate_group_key: k(s.escalate_group_id) };
    if (s.kind === "review")
      return {
        ...s,
        ...esc,
        department_group_id: null,
        department_group_key: k(s.department_group_id),
      };
    const signer = {
      ...s.company_signer,
      department_group_id: null,
      department_group_key: k(s.company_signer.department_group_id),
    };
    return { ...s, ...esc, company_signer: signer };
  });
  return missing.size ? { missing: [...missing] } : { body: { steps: out } };
}

type AnyStep = Record<string, unknown> & { company_signer?: Record<string, unknown> };
/** Def thư viện: `stage.slot` mang mã ở chỗ id (`compileSlotStages`) hoặc `*_key` (canvas gửi lại) ⇒ đưa mã về chỗ id để đổi. */
const keyIntoId = (s: AnyStep): AnyStep => {
  const pick = (id: unknown, key: unknown) => (id ?? key ?? null) as string | null;
  const out: AnyStep = {
    ...s,
    escalate_group_id: pick(s.escalate_group_id, s.escalate_group_key),
    department_group_id: pick(s.department_group_id, s.department_group_key),
  };
  if (s.kind === "dify") return s;
  if (s.kind !== "esign" || !s.company_signer) return out;
  const c = s.company_signer;
  const signer = { ...c, department_group_id: pick(c.department_group_id, c.department_group_key) };
  const { department_group_id: _d, ...rest } = out;
  return { ...rest, company_signer: signer };
};

/** CR-105 · canvas ⇒ body: `fromStages` (nghịch `compileDef`) rồi mã đứng chỗ id ⇒ `*_key`. Dạng sai ⇒ `{stage}`. */
export function slotBodyFromStages(
  stages: readonly unknown[],
): { body: SlotFlowBody } | { stage: string } {
  const r = fromStages(stages as StageLike[]);
  if (!r.ok) return { stage: r.stage };
  const steps = r.steps.map((s) => keyIntoId(s as unknown as AnyStep)) as unknown as FlowStep[];
  const k = keyedSlotBody(steps, (id) => id);
  if (!("body" in k)) return { stage: "" };
  return k;
}

/** Mặc định = máy 2 bước cũ (`defaultFlowFromSettings`) với mã Group của cài đặt (mã đứng chỗ id rồi chuyển sang `*_key`). */
export function defaultSlotBody(s: ApprovalSettings = APPROVAL_DEFAULTS): SlotFlowBody {
  const ids = new Map([s.level1GroupKey, s.level2GroupKey].map((x) => [x, x]));
  const r = keyedSlotBody(defaultFlowFromSettings(s, ids), (id) => id);
  if (!("body" in r)) throw new Error("approval-default-body");
  return r.body;
}
