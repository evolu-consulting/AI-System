// esign-flow · luật thuần bước Ký số của mẫu luồng duyệt + người cụ thể (duyệt/ký): tối đa 1 bước Ký số, phải là bước CUỐI; người ký
// công ty `dept_head` cần phòng, `user` cần người; hạn/nhắc trong giới hạn engine. Người cụ thể thuộc tenant + có quyền gói kiểm ở
// use case (`flowUserIds` ⇒ danh bạ thành viên). Lớp 1: chỉ builtin.
import { type EsignStepIssueField, esignStepIssues } from "@ai/contracts/pack-contracts";
import type { ApprovalFlowIssue, FlowEsignStep, FlowStep } from "./approval-flow.types";

const PATH: Record<EsignStepIssueField, string> = {
  step: "",
  signer_group: ".company_signer.department_group_id",
  signer_user: ".company_signer.user_id",
  due_h: ".due_h",
  remind_every_h: ".remind_every_h",
};

/** Bước Ký số: tối đa 1 (bước thừa ⇒ `ESIGN_MULTI`), phải là bước cuối (`ESIGN_NOT_LAST`), cấu hình người ký đủ — luật DÙNG CHUNG
 *  với admin-web (`esignStepIssues` ở `@ai/contracts/pack-contracts`); đây chỉ đổi tên trường sang đường dẫn `steps.i.…`. */
export function esignIssues(steps: readonly FlowStep[]): ApprovalFlowIssue[] {
  const out: ApprovalFlowIssue[] = [];
  let ordinal = 0;
  steps.forEach((s, i) => {
    if (s.kind !== "esign") return;
    ordinal += 1;
    const c = s.company_signer;
    for (const x of esignStepIssues(
      {
        due_h: s.due_h,
        remind_every_h: s.remind_every_h,
        signer_mode: c.mode,
        hasGroup: !!c.department_group_id,
        hasUser: !!c.user_id,
      },
      { index: i, count: steps.length, ordinal },
    ))
      out.push({ path: `steps.${i}${PATH[x.field]}`, rule: x.code });
  });
  return out;
}
/** Bước Ký số của mẫu (bước cuối) hoặc null. */
export function esignStepOf(steps: readonly FlowStep[] | null | undefined): FlowEsignStep | null {
  const last = steps?.[steps.length - 1];
  return last?.kind === "esign" ? last : null;
}

export type EsignStatus = "pending" | "sending" | "sent" | "completed" | "needs_decision";
export type EsignReason = "NO_PARTNER_EMAIL" | "NO_SIGNER" | "SEND_FAILED" | "DECLINED" | "VOIDED";
const STATUSES = new Set<string>(["sending", "sent", "completed", "needs_decision"]);
const REASONS = new Set<string>([
  "NO_PARTNER_EMAIL",
  "NO_SIGNER",
  "SEND_FAILED",
  "DECLINED",
  "VOIDED",
]);

/** esign-sweep2 · mốc của lần gửi hiện tại (`esign_at`) + lần nhắc cuối (`esign_reminded_at`) + giờ server. */
export type EsignTimes = { at: string | null; remindedAt: string | null; now: Date };

/** esign-sweep2 · hạn ký = `esign_at + due_h` (chỉ khi phong bì đã gửi chờ ký); quá hạn khi `now ≥ hạn`; "đã nhắc" chỉ tính lần nhắc
 *  của LẦN gửi hiện tại (mốc nhắc cũ hơn `esign_at` ⇒ của lần gửi trước, bỏ). */
export function esignDue(
  s: Pick<FlowEsignStep, "due_h">,
  st: EsignStatus,
  t: EsignTimes | undefined,
): { due_at: string | null; overdue: boolean; reminded_at: string | null } {
  const at = t?.at ? Date.parse(t.at) : Number.NaN;
  if (!t || st !== "sent" || Number.isNaN(at))
    return { due_at: null, overdue: false, reminded_at: null };
  const due = at + s.due_h * 3_600_000;
  const rem = t.remindedAt ? Date.parse(t.remindedAt) : Number.NaN;
  return {
    due_at: new Date(due).toISOString(),
    overdue: t.now.getTime() >= due,
    reminded_at: !Number.isNaN(rem) && rem >= at ? new Date(rem).toISOString() : null,
  };
}

/** Ô bước Ký số trên thẻ duyệt: mẫu chụp không có bước ký ⇒ null; chưa tới ⇒ `pending`. "Gửi lại" chỉ khi cần quyết. */
export function esignCard(
  steps: readonly FlowStep[] | null | undefined,
  status: string | null | undefined,
  reason: string | null | undefined,
  mayResend: boolean,
  stale = false,
  times?: EsignTimes,
) {
  const s = esignStepOf(steps);
  if (!s) return null;
  const st = (status && STATUSES.has(status) ? status : "pending") as EsignStatus;
  return {
    key: s.key,
    name: s.name,
    status: st,
    reason: (reason && REASONS.has(reason) ? reason : null) as EsignReason | null,
    can_resend: (st === "needs_decision" || (st === "sending" && stale)) && mayResend,
    ...esignDue(s, st, times),
  };
}

/** Người ký công ty theo cấu hình bước: owner ⇒ người phụ trách; dept_head ⇒ trưởng phòng; user ⇒ người cụ thể. */
export function signerOf(
  s: FlowEsignStep,
  f: { owner: string | null; deptHead: string | null },
): string | null {
  if (s.company_signer.mode === "owner") return f.owner;
  if (s.company_signer.mode === "dept_head") return f.deptHead;
  return s.company_signer.user_id ?? null;
}

/** Thứ tự người ký theo bước (đối tác có ⇒ email từ liên hệ đối tác). */
export function signersOf(
  s: FlowEsignStep,
  partner: { name: string; email: string } | null,
): ({ role: "company" } | { role: "partner"; name: string; email: string })[] {
  const company = { role: "company" as const };
  if (!s.partner_signs || !partner) return [company];
  const p = { role: "partner" as const, ...partner };
  return s.order === "partner_first" ? [p, company] : [company, p];
}

/** Người cụ thể mẫu tham chiếu (người duyệt + người ký công ty `user`) kèm đường dẫn trường — kiểm thuộc tenant + quyền gói. */
export function flowUserIds(steps: readonly FlowStep[]): { path: string; id: string }[] {
  const out: { path: string; id: string }[] = [];
  steps.forEach((s, i) => {
    if (s.kind === "review" && s.approver_user_id)
      out.push({ path: `steps.${i}.approver_user_id`, id: s.approver_user_id });
    if (s.kind === "esign" && s.company_signer.mode === "user" && s.company_signer.user_id)
      out.push({ path: `steps.${i}.company_signer.user_id`, id: s.company_signer.user_id });
  });
  return out;
}
