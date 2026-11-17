// CR-127 · U5 · K3/X3: Gửi lại · Rút về · Tạo lại từ HĐ bị từ chối · Tạm khoá / Mở khoá (cần bằng chứng). Mã lỗi + câu VI: tasks §9.
import type {
  HoldRequest,
  ManualEntryResponse,
  ReconcileResponse,
  SubmitRequest,
  SubmitResponse,
  WithdrawRequest,
} from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

const one = (id: string, tail: string) =>
  `/pack/contracts/contracts/${encodeURIComponent(id)}/${tail}`;

export const submitContract = (id: string, body: SubmitRequest = {}) =>
  api<SubmitResponse>(one(id, "submit"), { method: "POST", body });
/** CR-157: AI đọc lỗi ⇒ nhập tay trên chính HĐ; tích/bỏ "đã đối chiếu với tệp gốc" (không đổi version). */
export const startManualEntry = (id: string) =>
  api<ManualEntryResponse>(one(id, "manual-entry"), { method: "POST", body: {} });
export const reconcileContract = (id: string, reconciled: boolean) =>
  api<ReconcileResponse>(one(id, "reconcile"), { method: "PUT", body: { reconciled } });
/** CR-157b «Tải tệp khác»: HĐ nháp + AI đọc lỗi ⇒ thay tệp (multipart `file`) rồi AI đọc lại. */
export const replaceContractFile = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api<{ id: string; extract_state: string; version: number }>(one(id, "replace-file"), {
    method: "POST",
    rawBody: form as unknown as Blob,
  });
};
export const withdrawContract = (id: string, body: WithdrawRequest) =>
  api<{ status: "draft" }>(one(id, "withdraw"), { method: "POST", body });
export const recreateContract = (id: string) =>
  api<{ id: string }>(one(id, "recreate"), { method: "POST", body: {} });
export const holdContract = (id: string, body: HoldRequest) =>
  api<unknown>(one(id, "hold"), { method: "POST", body });
export const releaseContract = (id: string, body: HoldRequest) =>
  api<unknown>(one(id, "release"), { method: "POST", body });

/** Mã lỗi gửi/rút/tạo lại/khoá ⇒ khoá i18n `contracts.u5.err.*` (câu VI §9). */
const CODES = new Set([
  "STATE_CONFLICT",
  "CONTRACT_NOT_DRAFT",
  "EXTRACT_NOT_READY",
  "UNCHANGED_REASON_REQUIRED",
  "FILE_REQUIRED",
  "WITHDRAW_NOT_ALLOWED",
  "CONTRACT_NOT_REJECTED",
  "HOLD_EXISTS",
  "NOT_HELD",
  "HOLD_FORBIDDEN",
  "HOLD_NOT_ALLOWED",
  "EVIDENCE_REQUIRED",
  "EVIDENCE_FILE_NOT_OWNED",
  "NO_APPROVAL_FLOW",
  "RECONCILE_REQUIRED",
]);
export const execErrorKey = (code: string | undefined): string | null =>
  code === "SIGN_NOT_READY" // CR-181 s13
    ? "contracts.docsignc.err.SIGN_NOT_READY"
    : code && CODES.has(code)
      ? `contracts.u5.err.${code}`
      : null;
