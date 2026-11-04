// V2-J2 · truy vấn/ghi NCC & giá của một sản phẩm (tổng quan, xoá giá, tìm giá thị trường, lưu giá đã chọn).
import type { SupplierSearchOut } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteSupplierPrice,
  fetchSuppliers,
  saveSupplierPrices,
  searchSuppliers,
  supplierKeys,
} from "../api";
import { toSaveItems } from "../lib/suppliers";

const KNOWN = [
  "SEARCH_UNAVAILABLE",
  "SEARCH_CAP",
  "SEARCH_FAILED",
  "ACTION_QUOTA",
  "SCOUT_MONTHLY_CAP",
  "SCOUT_AGENT_DISABLED",
  "PACK_FORBIDDEN",
  "QUOTE_UNSUPPORTED",
  "QUOTE_UNREADABLE",
  "QUOTE_TOO_LARGE",
];

/** Mã lỗi API đã biết (có chuỗi dịch riêng) hoặc null. */
export const knownSupplierError = (x: unknown): string | null =>
  x instanceof ApiError && KNOWN.includes(x.code) ? x.code : null;

export const useSupplierOverview = (productId: string) =>
  useQuery({
    queryKey: supplierKeys.overview(productId),
    queryFn: ({ signal }) => fetchSuppliers(productId, signal),
  });

export function useDeleteSupplierPrice(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (priceId: string) => deleteSupplierPrice(productId, priceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplierKeys.overview(productId) }),
  });
}

export const useSupplierSearch = (
  productId: string,
  h: {
    onStart: () => void;
    onResult: (r: SupplierSearchOut) => void;
    onFail: (e: unknown) => void;
  },
) => {
  const qc = useQueryClient();
  // Dù thành công hay chạm trần, bộ đếm lượt dò tháng này đổi ⇒ tải lại.
  const refresh = () => qc.invalidateQueries({ queryKey: supplierKeys.scout(productId) });
  return useMutation({
    mutationFn: () => searchSuppliers(productId),
    onMutate: h.onStart,
    onSuccess: (r) => {
      void refresh();
      h.onResult(r);
    },
    onError: (e) => {
      void refresh();
      h.onFail(e);
    },
  });
};

export function useSaveSuppliers(
  productId: string,
  items: () => SupplierSearchOut["items"],
  h: { onDone: () => void; onFail: (e: unknown) => void },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => saveSupplierPrices(productId, toSaveItems(items())),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: supplierKeys.overview(productId) });
      h.onDone();
    },
    onError: h.onFail,
  });
}
