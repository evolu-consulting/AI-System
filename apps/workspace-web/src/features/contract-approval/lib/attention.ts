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
]);
const GROUP_PREFIX = "FLOW_GROUP_MISSING";

export type AttentionText = { key: string; vars?: { keys: string } };

/** Lý do (mã máy) ⇒ khoá i18n (+ biến). Mã lạ/null ⇒ câu chung, không lộ mã thô. */
export function attentionText(a: Pick<ApprovalAttention, "kind" | "reason">): AttentionText {
  const reason = a.reason ?? "";
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
