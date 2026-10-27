// V2-F · HD-11 · HD-04: mốc HĐ (V2-A `POST /contracts/:id/milestones`, `PATCH|DELETE /milestones/:id`) + xác nhận xong mốc
// (`POST /obligations/:id/settle` có `fault` khi trễ). Bearer + refresh do web-kit lo.
import type {
  DeliveryView,
  MilestoneCreate,
  MilestonePatch,
  ObligationImpact,
  StockCheckOut,
  StockCheckRequest,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts";

export const addMilestone = (contractId: string, body: MilestoneCreate) =>
  api<unknown>(`${BASE}/contracts/${encodeURIComponent(contractId)}/milestones`, {
    method: "POST",
    body,
  });
export const editMilestone = (id: string, body: MilestonePatch) =>
  api<unknown>(`${BASE}/milestones/${encodeURIComponent(id)}`, { method: "PATCH", body });
export const removeMilestone = (id: string) =>
  api<void>(`${BASE}/milestones/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Bảng Trên HĐ · Đã giao · Giao đợt này (V2-D; delivery-opts: SL tính sẵn theo % của mốc) + kiểm tồn (cảnh báo giao vượt tồn). */
export const getDelivery = (id: string) =>
  api<DeliveryView>(`${BASE}/milestones/${encodeURIComponent(id)}/delivery`);
export const checkStock = (body: StockCheckRequest) =>
  api<StockCheckOut>(`${BASE}/stock/check`, { method: "POST", body });

export type Fault = "partner" | "ours" | "unknown";
/** MS-impact: xem trước tác động THẬT (máy chủ tính, không ghi) theo ngày thực tế + lỗi. */
export const getImpact = (
  id: string,
  q: { at: string; fault?: Fault | undefined },
  signal?: AbortSignal,
) => {
  const p = new URLSearchParams({ actual_on: q.at, ...(q.fault ? { fault: q.fault } : {}) });
  return api<ObligationImpact>(`${BASE}/obligations/${encodeURIComponent(id)}/impact?${p}`, {
    ...(signal ? { signal } : {}),
  });
};
export const settleMilestone = (id: string, body: { at: string; fault?: Fault }) =>
  api<unknown>(`${BASE}/obligations/${encodeURIComponent(id)}/settle`, { method: "POST", body });
