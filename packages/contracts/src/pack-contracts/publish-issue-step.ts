// CR-125 · H2 · MỘT quy ước số bước trong lỗi kiểm quy trình: `issue.step` là SỐ THỨ TỰ TỪ 1 (như màn hình sửa quy trình: "Bước 3").
// Hub đổi `path` (đếm từ 0) sang số từ 1 ở MỘT chỗ (`explainIssue`); web đổi ngược sang chỉ số mảng ở MỘT chỗ (`issueStepIndex`).

/** `step` từ 1 (số nguyên ≥ 1) → chỉ số mảng từ 0; không hợp lệ ⇒ null (lỗi chung của quy trình). */
export const issueStepIndex = (step: unknown): number | null =>
  typeof step === "number" && Number.isInteger(step) && step >= 1 ? step - 1 : null;

/** Bước (từ 1) của chỉ số mảng `index` (từ 0). */
export const issueStepNumber = (index: number): number => index + 1;

/**
 * Mẫu dùng chung cho test hai phía (hub `explainIssue` · web `parsePublishIssues`): hub phải ra đúng `wire`, web phải đọc `wire.step` thành `index`.
 * Sai quy ước ở MỘT phía ⇒ test phía đó đỏ.
 */
export const PUBLISH_ISSUE_STEP_FIXTURE = [
  {
    issue: { path: "steps.2.department_group_id", rule: "GROUP_REQUIRED" },
    wire: { step: 3, field: "department_group_id", code: "GROUP_REQUIRED" },
    index: 2,
  },
  {
    issue: { path: "steps.0.when", rule: "FIRST_CONDITIONAL" },
    wire: { step: 1, field: "when", code: "FIRST_CONDITIONAL" },
    index: 0,
  },
  {
    issue: { path: "stages.3.slot.when", rule: "UNREACHABLE_STEP" },
    wire: { step: 3, field: "when", code: "UNREACHABLE_STEP" },
    index: 2,
  },
  {
    issue: { path: "steps", rule: "STEPS_MAX" },
    wire: { step: null, field: null, code: "STEPS_MAX" },
    index: null,
  },
] as const;
