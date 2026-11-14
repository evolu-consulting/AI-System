// W1 · "Mua hàng": dữ liệu + thao tác cho component (T-DEP-5: component chỉ trình bày, gọi API qua hook).
import type { SaleLine, SourceRef } from "@ai/contracts/pack-contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * Dòng bán của MỘT HĐ, tải dần (CR-151 mục 15): mỗi lần «Xem thêm» nạp thêm một trang (`page`), không chỉ trang 1.
 * `lines` gộp các trang đã tải; `candidates` gộp theo sản phẩm; `total` = số dòng khớp.
 */
export function useContractSourcingPaged(contract: string, pageSize: number, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...sourcingKeys.all, "contract-paged", contract, pageSize] as const,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      fetchSourcing({ contract, page: pageParam, page_size: pageSize }, signal),
    getNextPageParam: (last) =>
      last.page * last.page_size < last.total ? last.page + 1 : undefined,
    retry: false,
    enabled,
    select: (d) => ({
      lines: d.pages.flatMap((p) => p.lines),
      candidates: Object.assign({}, ...d.pages.map((p) => p.candidates)) as Record<
        string,
        SourceRef[]
      >,
      total: d.pages[0]?.total ?? 0,
    }),
  });
}

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
