// ADM-FR-71 · HUB-FR-144 · P-d1 · luật nhắc / chuyển cấp phía form (PD-R19/R20). Thuần, built-in.
import { ESCALATE_AFTER_H, REMIND_EVERY_H } from "./limits";

const intIn = (text: string, r: { min: number; max: number }): boolean => {
  const t = text.trim();
  return /^\d+$/.test(t) && Number(t) >= r.min && Number(t) <= r.max;
};

/** Rỗng hợp lệ (nhắc một lần sau 24 giờ); có giá trị thì nguyên 4…168. */
export function remindIssue(text: string): "range" | null {
  return text.trim() === "" || intIn(text, REMIND_EVERY_H) ? null : "range";
}

export type EscalateIssues = { afterH?: "range"; groupId?: "required" | "same" };

/** Tắt ⇒ không lỗi. Bật: 4…2160 giờ; nhóm bắt buộc và khác nhóm kiểm. */
export function escalateIssues(
  e: { on: boolean; afterH: string; groupId: string },
  reviewGroupId: string,
): EscalateIssues {
  if (!e.on) return {};
  const out: EscalateIssues = {};
  if (!intIn(e.afterH, ESCALATE_AFTER_H)) out.afterH = "range";
  if (e.groupId === "") out.groupId = "required";
  else if (e.groupId === reviewGroupId) out.groupId = "same";
  return out;
}
