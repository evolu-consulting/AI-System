// gap-d1 #21/#22 · tải báo giá lên (đọc → chưa lưu → lưu làm giá tham khảo), nhập giá tay, thêm NCC vào Đối tác.
import type { QuoteReadOut, SupplierPriceInput } from "@ai/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addCompany, readQuote, saveSupplierPrices, supplierKeys } from "../api";
import { toSaveItems } from "../lib/suppliers";

export const useReadQuote = (productId: string) =>
  useMutation({ mutationFn: (file: File) => readQuote(productId, file) });

/** Lưu dòng giá (nhập tay hoặc báo giá đã chọn) vào bảng so sánh rồi tải lại tổng quan. */
export function useSavePrices(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: SupplierPriceInput[]) => saveSupplierPrices(productId, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplierKeys.overview(productId) }),
  });
}
export const quoteSaveItems = (
  r: QuoteReadOut,
  picked: ReadonlySet<number>,
): SupplierPriceInput[] =>
  toSaveItems(
    r.items.filter((_, i) => picked.has(i)),
    "quote",
  );

import { ApiError } from "@ai/web-kit/http";

/** Đối tác đã có (409) ⇒ coi như đã thêm. */
export const isConflict = (e: unknown): boolean => e instanceof ApiError && e.status === 409;

export const useAddCompany = () => useMutation({ mutationFn: addCompany });
