// U3 · REP-v3-ui · điểm đối tác theo engine hiện hành (`GET /reputation/config` → `engine`): HD8 đọc `GET /partners` (hai vai), V2-E đọc
// `GET /reputation/partners` (vai × nhóm SP, gồm bên trả hoa hồng, kèm cờ đỏ). Cả hai về cùng dòng `ScoreRow` cho danh sách/Tổng quan.
import type { PartnerRole, RepEngine } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchPartnerScore, fetchPartners, partnerKeys } from "../api";
import { fromRep, roleRows, type ScoreRow } from "../lib/partner-score";
import { useEngine, useRepPartners } from "./use-rep-v2e";

/** Mọi dòng đối tác × vai; cờ đỏ: HD8 chỉ có ở danh sách theo vai (`?role=`), V2-E có sẵn trong `/reputation/partners`. */
export function usePartnerRows(): {
  data: ScoreRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  engine: RepEngine | undefined;
} {
  const { engine } = useEngine();
  const hd8 = engine === "hd8";
  const v2e = engine === "v2e";
  const customer = useQuery({
    queryKey: partnerKeys.list("customer"),
    queryFn: ({ signal }) => fetchPartners("customer", signal),
    enabled: hd8,
  });
  const supplier = useQuery({
    queryKey: partnerKeys.list("supplier"),
    queryFn: ({ signal }) => fetchPartners("supplier", signal),
    enabled: hd8,
  });
  const rep = useRepPartners(v2e);
  const data = useMemo(() => {
    if (v2e) return rep.data?.map(fromRep);
    return customer.data && supplier.data
      ? roleRows({ customer: customer.data, supplier: supplier.data })
      : undefined;
  }, [v2e, rep.data, customer.data, supplier.data]);
  return {
    data: hd8 || v2e ? data : undefined,
    isLoading:
      engine === undefined ||
      (hd8 && (customer.isLoading || supplier.isLoading)) ||
      (v2e && rep.isLoading),
    error: v2e ? rep.error : (customer.error ?? supplier.error),
    engine,
  };
}

export const usePartnerScore = (party: string, role: PartnerRole) =>
  useQuery({
    queryKey: partnerKeys.score(party, role),
    queryFn: ({ signal }) => fetchPartnerScore(party, role, signal),
    retry: false,
  });
