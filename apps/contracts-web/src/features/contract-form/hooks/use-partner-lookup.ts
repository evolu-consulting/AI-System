// V2-F · HD-10 · BA 5.6: tra đối tác `GET /partners/lookup` (V2-C), debounce — gõ ≥ 2 ký tự mới tra.
import type { ContractDeal } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { lookupKey, lookupPartner } from "../api";

const DEBOUNCE_MS = 300;

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function usePartnerLookup(name: string, taxId: string, deal: ContractDeal) {
  const q = useDebounced(name.trim(), DEBOUNCE_MS);
  const look = useQuery({
    queryKey: lookupKey(q, taxId, deal),
    queryFn: ({ signal }) => lookupPartner(q, taxId, deal, signal),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
  return { q, look };
}
