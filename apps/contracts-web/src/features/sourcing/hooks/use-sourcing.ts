// W1 · "Mua hàng": dữ liệu + thao tác cho component (T-DEP-5: component chỉ trình bày, gọi API qua hook).
import type { SaleLine, SourceRef } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chooseSource, fetchSourcing, type SourcingParams, sourcingKeys } from "../api";
import { parseRef } from "../lib/sourcing";

export type { SourcingParams };

/** Dòng bán của một HĐ (thẻ trên trang chi tiết HĐ); `enabled` = HĐ đã duyệt (có dòng giá). */
export const useContractSourcing = (params: SourcingParams, enabled: boolean) =>
  useQuery({
    queryKey: sourcingKeys.list(params),
    queryFn: ({ signal }) => fetchSourcing(params, signal),
    retry: false,
    enabled,
  });

/** Đổi nguồn một dòng bán (giá trị ô chọn ⇒ ứng viên; rỗng ⇒ về chọn tự động); xong ⇒ tải lại báo cáo. */
export function useChooseSource(candidates: Record<string, SourceRef[]>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { r: SaleLine; value: string }) => {
      const c = parseRef(v.value, candidates[v.r.product] ?? []);
      return chooseSource(
        v.r.contract_id,
        v.r.line,
        c && { contract_id: c.contract_id, line: c.line },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: sourcingKeys.all }),
  });
}
