// CR-097 G2: dữ liệu tham chiếu cho màn Giao dịch — danh mục SP (chọn dòng) + HĐ để liên kết/lọc + nhãn thành phần cho bảng kho.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchProducts, PRODUCTS_KEY } from "~/features/contract-form/api";
import { fetchList, listKey } from "~/features/contracts-list/api";

const CONTRACT_OPTS_QS = "page=1&page_size=100";
const STALE_MS = 60_000;

export function useTxRefs() {
  const products = useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: ({ signal }) => fetchProducts(signal),
    staleTime: STALE_MS,
  });
  const contracts = useQuery({
    queryKey: listKey(CONTRACT_OPTS_QS),
    queryFn: ({ signal }) => fetchList(CONTRACT_OPTS_QS, signal),
    staleTime: STALE_MS,
  });
  const prods = products.data ?? [];
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products.data ?? []) {
      for (const c of p.components)
        m.set(c.id, p.components.length > 1 ? `${p.name} · ${c.name}` : p.name);
    }
    return m;
  }, [products.data]);
  const contractOptions = (contracts.data?.items ?? []).map((c) => ({
    id: c.id,
    label: c.number ? `${c.title} (${c.number})` : c.title,
  }));
  return { products: prods, labels, contractOptions };
}
