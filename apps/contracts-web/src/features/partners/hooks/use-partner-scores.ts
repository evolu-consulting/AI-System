// U3 · điểm đối tác từ engine HD8 (`GET /partners`, `/partners/score`): danh sách hai vai gộp một mảng, chi tiết một đối tác × vai.
import type { PartnerRole } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchPartnerScore, fetchPartners, partnerKeys } from "../api";
import { roleRows } from "../lib/partner-score";

/** Mọi dòng đối tác × vai (khách hàng + nhà cung cấp): cờ đỏ chỉ có ở danh sách theo vai (`?role=`). */
export function usePartnerRows() {
  const customer = useQuery({
    queryKey: partnerKeys.list("customer"),
    queryFn: ({ signal }) => fetchPartners("customer", signal),
  });
  const supplier = useQuery({
    queryKey: partnerKeys.list("supplier"),
    queryFn: ({ signal }) => fetchPartners("supplier", signal),
  });
  const data = useMemo(
    () =>
      customer.data && supplier.data
        ? roleRows({ customer: customer.data, supplier: supplier.data })
        : undefined,
    [customer.data, supplier.data],
  );
  return {
    data,
    isLoading: customer.isLoading || supplier.isLoading,
    error: customer.error ?? supplier.error,
  };
}

export const usePartnerScore = (party: string, role: PartnerRole) =>
  useQuery({
    queryKey: partnerKeys.score(party, role),
    queryFn: ({ signal }) => fetchPartnerScore(party, role, signal),
    retry: false,
  });
