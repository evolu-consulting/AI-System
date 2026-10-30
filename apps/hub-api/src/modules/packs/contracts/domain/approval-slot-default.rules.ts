// CR-105 · L2a · design §1/§6: quy trình mặc định của khe `contracts.approval` (seed hub 0069) + đổi mẫu tenant cũ (Group theo id)
// sang `slot_body` theo MÃ cho script chuyển dữ liệu. Thuần, lớp 1.
import { APPROVAL_DEFAULTS, type ApprovalSettings } from "./approval-def.rules";
import { defaultFlowFromSettings } from "./approval-flow.rules";
import type { FlowStep } from "./approval-flow.types";
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

/** Mặc định = máy 2 bước cũ (`defaultFlowFromSettings`) với mã Group của cài đặt (mã đứng chỗ id rồi chuyển sang `*_key`). */
export function defaultSlotBody(s: ApprovalSettings = APPROVAL_DEFAULTS): SlotFlowBody {
  const ids = new Map([s.level1GroupKey, s.level2GroupKey].map((x) => [x, x]));
  const r = keyedSlotBody(defaultFlowFromSettings(s, ids), (id) => id);
  if (!("body" in r)) throw new Error("approval-default-body");
  return r.body;
}
