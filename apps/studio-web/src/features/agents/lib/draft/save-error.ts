// HUB-FR-60 · H4a-R03 · lỗi lưu (không phải 409 VERSION_CONFLICT) → lỗi gắn trường / câu chung / toast theo mã (plan-frontend-copy).
import { describeApiError, type MessageSpec } from "#/lib/api-error";
import { FIELD_MESSAGE, type FieldErrors, fieldOfPath, mapIssues } from "./draft";

export type SaveFailure = { errors: FieldErrors; invalid: boolean; toast?: MessageSpec };

type Detailed = { code?: unknown; details?: { issues?: unknown; field?: unknown } | null };

/** dlc-agent-flows · `INVALID_REFERENCE` của `pack_tools`/`dlc_flows` ⇒ lỗi gắn section "Quy trình DLC"; còn lại ⇒ null. */
function dlcRefError(e: Detailed): SaveFailure | null {
  const f = e.code === "INVALID_REFERENCE" ? fieldOfPath(e.details?.field) : null;
  return f === "pack_tools" || f === "dlc_flows"
    ? { errors: { [f]: FIELD_MESSAGE[f] }, invalid: false }
    : null;
}

export function classifySaveError(err: unknown): SaveFailure {
  const e = (err ?? {}) as Detailed;
  const dlc = dlcRefError(e);
  if (dlc) return dlc;
  switch (e.code) {
    case "VALIDATION_ERROR": {
      const issues = Array.isArray(e.details?.issues)
        ? (e.details?.issues as { path?: unknown }[])
        : [];
      const { errors, unmapped } = mapIssues(issues);
      return { errors, invalid: unmapped > 0 || Object.keys(errors).length === 0 };
    }
    case "KEY_TAKEN":
      return { errors: { key: "errors.KEY_TAKEN" }, invalid: false };
    case "BASH_ACK_REQUIRED":
      return { errors: { bash_ack: "editor.err.bashAck" }, invalid: false };
    default:
      return { errors: {}, invalid: false, toast: describeApiError(err) };
  }
}
