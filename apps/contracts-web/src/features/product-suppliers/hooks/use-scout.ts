// price-scout · truy vấn/ghi cấu hình dò giá của một sản phẩm (đọc, lưu ghi đè, về mặc định nhóm).
import type { PriceScoutOverride } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchProductScout, saveProductScout, supplierKeys } from "../api";

export const useProductScout = (productId: string) =>
  useQuery({
    queryKey: supplierKeys.scout(productId),
    queryFn: ({ signal }) => fetchProductScout(productId, signal),
  });

export function useSaveProductScout(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PriceScoutOverride) => saveProductScout(productId, body),
    onSuccess: (data) => qc.setQueryData(supplierKeys.scout(productId), data),
  });
}
