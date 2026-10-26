// CR-097 G2 · GD-FR-01…05: API Giao dịch (`/pack/contracts/transactions`) — danh sách, chi tiết, nháp, ghi sổ, mô tả, điều chỉnh, huỷ.
import type {
  TransactionActionOut,
  TransactionAdjust,
  TransactionDescribe,
  TransactionDetail,
  TransactionDraft,
  TransactionDraftPatch,
  TransactionListOut,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/transactions";

export const TX_KEY = ["transactions"] as const;
export const txListKey = (qs: string) => ["transactions", "list", qs] as const;
export const txKey = (id: string) => ["transactions", "one", id] as const;

export const fetchTxList = (qs: string, signal?: AbortSignal): Promise<TransactionListOut> =>
  api<TransactionListOut>(`${BASE}?${qs}`, { signal });
export const fetchTx = (id: string, signal?: AbortSignal): Promise<TransactionDetail> =>
  api<TransactionDetail>(`${BASE}/${id}`, { signal });
export const createTx = (body: TransactionDraft): Promise<TransactionDetail> =>
  api<TransactionDetail>(BASE, { method: "POST", body });
export const patchTx = (id: string, body: TransactionDraftPatch): Promise<TransactionDetail> =>
  api<TransactionDetail>(`${BASE}/${id}`, { method: "PATCH", body });
export const deleteTx = (id: string): Promise<void> =>
  api<void>(`${BASE}/${id}`, { method: "DELETE" });
export const postTx = (id: string): Promise<TransactionActionOut> =>
  api<TransactionActionOut>(`${BASE}/${id}/post`, { method: "POST" });
export const describeTx = (id: string, body: TransactionDescribe): Promise<TransactionDetail> =>
  api<TransactionDetail>(`${BASE}/${id}/describe`, { method: "PATCH", body });
export const adjustTx = (id: string, body: TransactionAdjust): Promise<TransactionActionOut> =>
  api<TransactionActionOut>(`${BASE}/${id}/adjust`, { method: "POST", body });
export const cancelTx = (id: string, reason: string): Promise<TransactionActionOut> =>
  api<TransactionActionOut>(`${BASE}/${id}/cancel`, { method: "POST", body: { reason } });
