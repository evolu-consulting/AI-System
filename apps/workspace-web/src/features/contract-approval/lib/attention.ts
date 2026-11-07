// CR-107 · eng-card-ui: mã lý do của `ContractApproval.attention` → khoá i18n dễ hiểu (thuần, không React).
// FLOW_ROUTE_NONE / FLOW_ROUTE_UNAVAILABLE: luật chọn quy trình (CR-118).
// needs_decision: mã engine (`tool_failed`, `retry_exhausted`…). stalled: `FLOW_*`, `CANCELLED_BY_OWNER`, `ENGINE_RUN_*`.
import type { ApprovalAttention } from "@ai/contracts/pack-contracts";
import { releaseNoteKey } from "./engine-card";

const BASE = "contracts.approval.engine.attention.reason";
const DECISION_KNOWN = new Set(["tool_failed", "retry_exhausted", "job_timeout"]);
const STALLED_KNOWN = new Set([
  "FLOW_INVALID",
  "FLOW_MISSING",
  "FLOW_ROUTE_NONE",
  "FLOW_ROUTE_UNAVAILABLE",
  "CANCELLED_BY_OWNER",
  // CR-122 · P11b · flow theo sự kiện không mở được lượt (bộ điều phối báo) / chờ quá 2 phút
  "FLOW_NOT_ASSIGNED",
  "FLOW_REFUSED",
  "FLOW_START_FAILED",
  "FLOW_STARTING",
  "RECEIVE_NO_OWNER", // CR-124 · HĐ nhận từ đối tác: công ty nhận chưa có người phụ trách chạy flow nhận
]);
const GROUP_PREFIX = "FLOW_GROUP_MISSING";
/** p24 · mã lỗi hub ghi thẳng làm lý do ⇒ cùng câu với bản "FLOW_*" tương ứng. */
const HUB_CODE_ALIAS: Record<string, string> = {
  GROUPS_MISSING: GROUP_PREFIX,
  APPROVAL_FLOW_STARTING: "FLOW_STARTING",
};
const normReason = (r: string | null | undefined): string => HUB_CODE_ALIAS[r ?? ""] ?? r ?? "";

export type AttentionText = { key: string; vars?: { keys?: string; code?: string } };

/** CR-122 · p19 · mã lỗi bước tự động đã biết cách xử lý (`last_error_code` của stage) ⇒ câu "vì sao + làm gì". */
const TOOL_CODES = new Set([
  "ESIGN_DISABLED",
  "ESIGN_PROVIDER_UNAVAILABLE",
  "ESIGN_STATE",
  "ESIGN_UNSUPPORTED_FILE",
  "ESIGN_NOT_SIGNER",
  "NO_PARTNER_EMAIL",
  "ESIGN_NODE_NO_SIGNER",
  "ESIGN_NODE_CONFIG_INVALID",
  "CONTRACT_NOT_FOUND",
  "TOOL_OFF",
  "NO_REAL_ACTION",
  "INPUT_SCHEMA_INVALID",
  "RESULT_TOO_LARGE",
  "OUTPUT_REJECTED",
  "TOOL_CRASH",
]);
const MISSING_ARG = "MISSING_ARG";

/** Mã lỗi tool ⇒ khoá i18n; mã lạ ⇒ câu chung kèm mã (để báo quản trị). */
function toolCodeText(code: string): AttentionText {
  const head = code.split(":")[0] ?? "";
  if (head === MISSING_ARG)
    return {
      key: `${BASE}.tool.${MISSING_ARG}`,
      vars: { keys: code.slice(MISSING_ARG.length + 1) },
    };
  if (TOOL_CODES.has(head)) return { key: `${BASE}.tool.${head}` };
  return { key: `${BASE}.tool.UNKNOWN`, vars: { code: head.slice(0, 64) } };
}

/** Lý do (mã máy) ⇒ khoá i18n (+ biến). Mã lạ/null ⇒ câu chung, không lộ mã thô (trừ mã lỗi bước tự động lạ: kèm mã để báo quản trị). */
export function attentionText(
  a: Pick<ApprovalAttention, "kind" | "reason" | "missing"> & { code?: string | null },
): AttentionText {
  const reason = normReason(a.reason);
  // CR-122 · P18 · điều kiện rẽ nhánh cần dữ liệu còn trống: nêu đúng NHÃN trường + cách khắc phục.
  if (a.kind === "needs_decision" && reason === "missing_fact")
    return a.missing?.length
      ? { key: `${BASE}.missing_fact`, vars: { keys: a.missing.join(", ") } }
      : { key: `${BASE}.missing_fact_any` };
  if (a.kind === "needs_decision" && reason === "tool_failed" && a.code)
    return toolCodeText(a.code);
  if (a.kind === "needs_decision")
    return { key: `${BASE}.${DECISION_KNOWN.has(reason) ? reason : "other"}` };
  if (reason === GROUP_PREFIX || reason.startsWith(`${GROUP_PREFIX}:`)) {
    const keys = reason
      .slice(GROUP_PREFIX.length + 1)
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .join(", ");
    return keys
      ? { key: `${BASE}.${GROUP_PREFIX}`, vars: { keys } }
      : { key: `${BASE}.${GROUP_PREFIX}_ANY` };
  }
  if (STALLED_KNOWN.has(reason)) return { key: `${BASE}.${reason}` };
  // ENGINE_RUN_<STATUS> dùng lại nhãn "run kết thúc bất thường" sẵn có; còn lại ⇒ câu chung.
  return { key: releaseNoteKey(reason) ?? "contracts.approval.engine.release.OTHER" };
}

/** Chủ hợp đồng/quản trị gói thấy nút xử lý; người khác chỉ thấy câu "báo chủ hợp đồng". */
export const attentionActions = (
  a: Pick<ApprovalAttention, "kind">,
  owner: boolean,
): { retry: boolean; cancelReopen: boolean; reopen: boolean; tellOwner: boolean } => ({
  retry: owner && a.kind === "needs_decision",
  cancelReopen: owner && a.kind === "needs_decision",
  reopen: owner && a.kind === "stalled",
  tellOwner: !owner,
});
