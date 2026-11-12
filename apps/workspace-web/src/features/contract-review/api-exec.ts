// CR-127 · U5 · K3/X3: Gửi lại · Rút về · Tạo lại từ HĐ bị từ chối · Tạm khoá / Mở khoá (cần bằng chứng). Mã lỗi + câu VI: tasks §9.
import type {
  HoldRequest,
  SubmitRequest,
  SubmitResponse,
  WithdrawRequest,
} from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

const one = (id: string, tail: string) =>
  `/pack/contracts/contracts/${encodeURIComponent(id)}/${tail}`;

export const submitContract = (id: string, body: SubmitRequest = {}) =>
  api<SubmitResponse>(one(id, "submit"), { method: "POST", body });
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
]);
export const execErrorKey = (code: string | undefined): string | null =>
  code && CODES.has(code) ? `contracts.u5.err.${code}` : null;
