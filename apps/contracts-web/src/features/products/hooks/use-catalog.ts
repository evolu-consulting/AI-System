// gap-d1 · truy vấn/ghi của tab Kho & lô, Nhận diện, Cách lấy hàng và hộp thoại "Thêm sản phẩm".
import { ApiError } from "@ai/web-kit/http";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bizKeys } from "../api";
import {
  addLot,
  addRule,
  addSource,
  catalogKeys,
  createProduct,
  deleteRule,
  deleteSource,
  fetchProduct,
  fetchSources,
} from "../catalog-api";

const KNOWN = ["PRODUCT_EXISTS", "PRODUCT_INVALID", "SOURCE_EXISTS", "PACK_FORBIDDEN"];
/** Mã lỗi API đã biết (có chuỗi dịch riêng) hoặc null. */
export const knownCatalogError = (x: unknown): string | null =>
  x instanceof ApiError && KNOWN.includes(x.code) ? x.code : null;

export const useCatalogProduct = (id: string) =>
  useQuery({ queryKey: catalogKeys.detail(id), queryFn: ({ signal }) => fetchProduct(id, signal) });
export const useProductSources = (id: string) =>
  useQuery({
    queryKey: catalogKeys.sources(id),
    queryFn: ({ signal }) => fetchSources(id, signal),
  });

/** Sau khi ghi: tải lại chi tiết catalog + điểm kinh doanh (danh sách/chi tiết) của SP. */
function useRefresh(id: string | null) {
  const qc = useQueryClient();
  return async () => {
    if (id) await qc.invalidateQueries({ queryKey: catalogKeys.detail(id) });
    await qc.invalidateQueries({ queryKey: ["business"] });
    if (id) await qc.invalidateQueries({ queryKey: ["products", id] });
  };
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => qc.invalidateQueries({ queryKey: bizKeys.list }),
  });
}
export function useAddLot(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (b: Parameters<typeof addLot>[1]) => addLot(id, b),
    onSuccess: refresh,
  });
}
export function useAddRule(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (b: Parameters<typeof addRule>[1]) => addRule(id, b),
    onSuccess: refresh,
  });
}
export function useDeleteRule(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (ruleId: string) => deleteRule(id, ruleId),
    onSuccess: refresh,
  });
}
export function useAddSource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Parameters<typeof addSource>[1]) => addSource(id, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKeys.sources(id) }),
  });
}
export function useDeleteSource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => deleteSource(id, sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: catalogKeys.sources(id) }),
  });
}
