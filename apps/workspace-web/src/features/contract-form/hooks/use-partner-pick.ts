// CR-122 p10: danh sách đối tác từ sổ (debounce) + gợi ý khớp một lần cho tên/MST do AI đọc ra.
import type { ContractDeal } from "@ai/contracts/pack-contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { searchPartners } from "../api";
import { ROLE_OF_DEAL, type Suggestion, suggestMatch } from "../lib/partner-match";

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function usePartnerOptions(text: string, deal: ContractDeal, open: boolean) {
  const q = useDebounced(text.trim(), 200);
  const role = ROLE_OF_DEAL[deal];
  return useQuery({
    queryKey: ["partner-search", q, role],
    queryFn: ({ signal }) => searchPartners(q, role, signal),
    enabled: open,
    staleTime: 15_000,
  });
}

/** Chạy một lần khi `enabled` (AI vừa đọc tên/MST): tra MST rồi tên, trả gợi ý. */
export function usePartnerSuggest(
  init: { name: string; taxId: string },
  deal: ContractDeal,
  enabled: boolean,
) {
  const role = ROLE_OF_DEAL[deal];
  const has = init.name.trim() !== "" || init.taxId.trim() !== "";
  return useQuery<Suggestion>({
    queryKey: ["partner-suggest", init.name, init.taxId, role],
    queryFn: async ({ signal }) => {
      const [byTax, byName] = await Promise.all([
        init.taxId.trim() ? searchPartners(init.taxId.trim(), role, signal) : Promise.resolve([]),
        init.name.trim() ? searchPartners(init.name.trim(), role, signal) : Promise.resolve([]),
      ]);
      return suggestMatch(init, byTax, byName);
    },
    enabled: enabled && has,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
