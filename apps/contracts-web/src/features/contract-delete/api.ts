// V2-M · HD-07 · C7: xem trước tác động + xoá hẳn một hợp đồng (chỉ vai quản lý). Bearer + refresh do web-kit lo.
import type { DeleteImpact, DeleteResult } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts/contracts";

export const deleteImpactKey = (id: string) => ["contract", id, "delete-preview"] as const;

export const fetchDeleteImpact = (id: string, signal?: AbortSignal) =>
  api<DeleteImpact>(`${BASE}/${encodeURIComponent(id)}/delete-preview`, { signal });

/** `removeProducts`: SP mồ côi người xoá đã tick (products-confirm); rỗng ⇒ không xoá SP nào. */
export const deleteContract = (id: string, removeProducts: string[] = []) =>
  api<DeleteResult>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: { remove_products: removeProducts },
  });
