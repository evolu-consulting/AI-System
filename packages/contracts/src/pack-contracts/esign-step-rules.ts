// CR-125 · c1 · MỘT luật bước Ký số của mẫu luồng duyệt (trước đây viết hai lần: hub `approval-flow-esign.rules.ts` và client admin
// `flow-form.ts`) + MỘT bộ câu lỗi (VI/EN). Thuần, không I/O. Hub và admin-web cùng gọi `esignStepIssues`; chỉ khác cách đặt tên
// trường (mã phòng / id phòng) nên luật nhận cờ `hasGroup` / `hasUser` đã tính sẵn.
import { APPROVAL_FLOW_DUE_H, APPROVAL_FLOW_REMIND_H } from "./approval-flow";

export type EsignStepIssueCode =
  | "ESIGN_MULTI"
  | "ESIGN_NOT_LAST"
  | "SIGNER_GROUP_REQUIRED"
  | "SIGNER_USER_REQUIRED"
  | "DUE_RANGE"
  | "REMIND_RANGE";
/** Trường gây lỗi (tên trung lập; mỗi nơi tự đổi sang đường dẫn riêng). */
export type EsignStepIssueField =
  | "step"
  | "signer_group"
  | "signer_user"
  | "due_h"
  | "remind_every_h";
export type EsignStepIssue = { field: EsignStepIssueField; code: EsignStepIssueCode };

export type EsignStepFacts = {
  due_h: number;
  remind_every_h: number | null;
  /** Cách chọn người ký công ty: owner | dept_head | user. */
  signer_mode: string;
  hasGroup: boolean;
  hasUser: boolean;
};

const inRange = (v: number, r: { min: number; max: number }) =>
  Number.isInteger(v) && v >= r.min && v <= r.max;

/** Lỗi của MỘT bước Ký số ở vị trí `index` trong `count` bước; `ordinal` = đây là bước Ký số thứ mấy (từ 1). */
export function esignStepIssues(
  s: EsignStepFacts,
  where: { index: number; count: number; ordinal?: number },
): EsignStepIssue[] {
  const out: EsignStepIssue[] = [];
  const add = (field: EsignStepIssueField, code: EsignStepIssueCode) => out.push({ field, code });
  if ((where.ordinal ?? 1) > 1) add("step", "ESIGN_MULTI");
  else if (where.index !== where.count - 1) add("step", "ESIGN_NOT_LAST");
  if (s.signer_mode === "dept_head" && !s.hasGroup) add("signer_group", "SIGNER_GROUP_REQUIRED");
  if (s.signer_mode === "user" && !s.hasUser) add("signer_user", "SIGNER_USER_REQUIRED");
  if (!inRange(s.due_h, APPROVAL_FLOW_DUE_H)) add("due_h", "DUE_RANGE");
  if (s.remind_every_h !== null && !inRange(s.remind_every_h, APPROVAL_FLOW_REMIND_H))
    add("remind_every_h", "REMIND_RANGE");
  return out;
}

/** MỘT bộ câu lỗi bước Ký số (hub trả cho API, admin/workspace hiển thị) — i18n JSON bị test so khớp với bảng này. */
export const ESIGN_STEP_TEXT: Record<
  "ESIGN_MULTI" | "ESIGN_NOT_LAST" | "SIGNER_GROUP_REQUIRED" | "SIGNER_USER_REQUIRED",
  { vi: string; en: string }
> = {
  ESIGN_MULTI: { vi: "Chỉ được một bước Ký số.", en: "Only one e-signature step is allowed." },
  ESIGN_NOT_LAST: {
    vi: "Bước Ký số phải là bước cuối.",
    en: "The e-signature step must be last.",
  },
  SIGNER_GROUP_REQUIRED: {
    vi: "Chọn phòng của người ký.",
    en: "Choose the signer's department.",
  },
  SIGNER_USER_REQUIRED: { vi: "Chọn người ký.", en: "Choose the signer." },
};
