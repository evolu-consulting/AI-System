// ADM-FR-66 · CR-056 · P-a F5 · P-d1: kiểu bản nháp của editor quy trình (tách khỏi `def-form` để các module `*-form` không import vòng).
// Chỉ kiểu — không giá trị; `def-form` re-export cho nơi dùng cũ.
import type { AutofixDraft } from "./autofix-form";
import type { InputDraft, StageSourceDraft } from "./sources-form";

/** P-d1 · khối "Chờ tới ngày": nguồn ngày (`input:<key>` | `field:<stage_key>:<field>`), chênh (ngày, chữ), giờ `HH:mm`. */
export type WaitDraft = { source: string; offset: string; time: string };
export type EscalateDraft = { on: boolean; afterH: string; groupId: string };

export type FieldDraft = { key: string; type: "number" | "string" | "date"; required: boolean };
export type StageDraft = {
  /** Khoá React cục bộ (không gửi đi). */
  uid: string;
  /** Mã giai đoạn còn tự sinh từ tên (người dùng chưa sửa tay). */
  keyAuto: boolean;
  key: string;
  name: string;
  /** `agent:<id>` | `team:<id>` | "" (chưa chọn). */
  executor: string;
  instruction: string;
  filename: string;
  template: string;
  sections: string[];
  fields: FieldDraft[];
  after: "review" | "auto";
  /** P-b2 · bước 0-based (UI hiển thị `step+1`); mảng stage luôn không giảm theo `step`, liên tục từ 0. */
  step: number;
  /** P-b2 · bước được phép quay lại khi Chưa đạt (< `step`); chỉ có nghĩa khi `after = review`. */
  backTo: number[];
  groupId: string;
  real: boolean;
  answerer: "starter" | "group" | "user";
  answererId: string;
  timeout: string;
  budget: string;
  /** Nguồn dùng + allowlist (textarea) — `sources-form`. */
  sources: StageSourceDraft[];
  /** `must_know`, mỗi dòng một mục. */
  mustKnow: string;
  /** P-c1 · khối "Tự sửa mã" (tắt ⇒ `autofix: null`, giữ giá trị đã nhập). */
  autofix: AutofixDraft;
  /** P-d1 · khối "Chờ tới ngày" (chỉ có nghĩa khi `executor = wait_until`). */
  wait: WaitDraft;
  /** P-d1 · "Nhắc mỗi (giờ)" — rỗng = `remind_every_h: null`; chỉ có nghĩa khi `after = review`. */
  remind: string;
  /** P-d1 · "Chuyển cấp nếu chưa ai kiểm" (tắt ⇒ `escalate: null`, giữ giá trị đã nhập). */
  escalate: EscalateDraft;
};
export type DefDraft = {
  key: string;
  name: string;
  description: string;
  hint: string;
  groupIds: string[];
  budget: string;
  enabled: boolean;
  stages: StageDraft[];
  /** Khoá nguồn của quy trình (≤ 20). */
  sources: string[];
  inputs: InputDraft[];
  /** P-d1 · "Thời hạn lượt chạy (ngày)" (chữ) + "Không hết hạn" ⇒ `ttl_days: null`. */
  ttl: string;
  noExpiry: boolean;
};
/** path (`stages.0.output.filename`) → khoá i18n của câu lỗi. */
export type DraftErrors = Record<string, string>;
