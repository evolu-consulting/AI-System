// CR-125 · G1 · MỘT nguồn mã lỗi kiểm quy trình (xuất bản / gán / sửa mẫu luồng): Hub trả `{rule, code, params}`, web dịch bằng
// MỘT khoá i18n mỗi mã (`PUBLISH_ISSUE_KEY.<mã>`). Thuần, không chữ tiếng Việt/Anh nào ở đây hay ở hub; `check:error-codes` giữ vậy.
import {
  APPROVAL_FLOW_DUE_H,
  APPROVAL_FLOW_REMIND_H,
  APPROVAL_FLOW_RULES,
  APPROVAL_FLOW_STEPS_MAX,
  FLOW_WAIT_OFFSET_DAYS,
} from "./approval-flow";

/** Mã chỉ trình xuất bản thư viện / gán công ty phát (luật khe, điều kiện, nút hệ thống, mã phòng ban theo công ty). */
export const PUBLISH_ISSUE_EXTRA_RULES = [
  "SLOT_SHAPE",
  "GROUP_ID_IN_LIBRARY",
  "NODE_UNSUPPORTED",
  "COND_FIELD_UNDECLARED",
  "COND_OP_UNSUPPORTED",
  "COND_VALUE_INVALID",
  "COND_NESTING",
  "SYSTEM_TOOL_MISSING",
  "UNREACHABLE_STEP",
  "GROUP_MISSING_IN_TENANT",
] as const;

/** Mọi mã lỗi kiểm quy trình: luật mẫu luồng duyệt + luật riêng của thư viện. */
export const PUBLISH_ISSUE_CODES: readonly string[] = [
  ...APPROVAL_FLOW_RULES,
  ...PUBLISH_ISSUE_EXTRA_RULES,
];

/** Tiền tố khoá i18n (process/admin) của câu cho mỗi mã: `${PUBLISH_ISSUE_KEY}.<MÃ>`. */
export const PUBLISH_ISSUE_KEY = "process.admin.library.form.err";

/** Biến nội suy của câu theo mã: giới hạn lấy từ hằng chung, `arg` = phần sau dấu `:` của `rule` (tên trường / nút / mã phòng). */
export function publishIssueParams(code: string, arg = ""): Record<string, string | number> {
  switch (code) {
    case "DUE_RANGE":
      return { min: APPROVAL_FLOW_DUE_H.min, max: APPROVAL_FLOW_DUE_H.max };
    case "REMIND_RANGE":
      return { min: APPROVAL_FLOW_REMIND_H.min, max: APPROVAL_FLOW_REMIND_H.max };
    case "WAIT_OFFSET_RANGE":
      return { min: FLOW_WAIT_OFFSET_DAYS.min, max: FLOW_WAIT_OFFSET_DAYS.max };
    case "STEPS_MAX":
      return { max: APPROVAL_FLOW_STEPS_MAX };
    default:
      return arg ? { param: arg } : {};
  }
}
