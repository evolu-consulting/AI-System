// CR-127 · U5 · X1/X3/X4/X5: ghi thực hiện mốc (xác nhận có bằng chứng, dời hạn qua yêu cầu thay đổi, quyết phạt) + đọc mốc kèm việc nhóm.
import type {
  ChangeRequest,
  ExecRequestOut,
  FulfillRequest,
  Obligation,
  PenaltyDecision,
  PenaltyOut,
  PenaltyView,
} from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts";
const enc = encodeURIComponent;

export const obligationsKey = (contractId: string) =>
  ["contract", contractId, "obligations"] as const;
export const penaltiesKey = (contractId: string) => ["contract", contractId, "penalties"] as const;

/** Mốc của MỘT HĐ kèm `task` (chưa ai nhận / ai đang xử lý). */
export const listObligations = (contractId: string, signal?: AbortSignal) =>
  api<Obligation[]>(`${BASE}/obligations?contract_id=${enc(contractId)}`, {
    ...(signal ? { signal } : {}),
  });

export const fulfillMilestone = (id: string, body: FulfillRequest) =>
  api<unknown>(`${BASE}/obligations/${enc(id)}/fulfill`, { method: "POST", body });

export const requestChange = (id: string, body: ChangeRequest) =>
  api<ExecRequestOut>(`${BASE}/obligations/${enc(id)}/change-requests`, { method: "POST", body });

export const listPenalties = (contractId: string, signal?: AbortSignal) =>
  api<{ items: PenaltyView[] }>(`${BASE}/contracts/${enc(contractId)}/penalties`, {
    ...(signal ? { signal } : {}),
  });

export const decidePenalty = (id: string, body: PenaltyDecision) =>
  api<PenaltyOut>(`${BASE}/obligations/${enc(id)}/penalty`, { method: "POST", body });
