// dlc-chat-review · nội dung đầy đủ của một bước DLC để người duyệt đọc trong chat (output stage chỉ là bảng tóm tắt). Thuần.
import type { DlcState } from "../application/ports";

/** Khoá bước hợp lệ trên URL (`spec`, `qc`, `report`…). */
export const DLC_STEP_KEY_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Trần ký tự trả về (state đã cắt 40 000/bước; chặn thêm cho chắc). */
export const DLC_DETAIL_MAX = 60_000;

const pick = (...xs: (string | undefined)[]): string => xs.find((x) => x?.trim()) ?? "";

/** Bản đầy đủ của bước: plan (spec), báo cáo (report), nghiệm thu (verify); bước khác ⇒ kết quả gần nhất của agent. */
export function dlcStepDetail(state: DlcState, step: string): string {
  const last = state.results?.[step];
  const text =
    step === "spec"
      ? pick(state.planText, last)
      : step === "report"
        ? pick(state.report, last)
        : step === "verify"
          ? pick(state.verifyReport, last)
          : pick(last);
  return text.slice(0, DLC_DETAIL_MAX);
}
