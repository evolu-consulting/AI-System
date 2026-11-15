// HD7-FR-04…12: truy vấn + lệnh ghi của sổ đối tác — component không gọi api.ts trực tiếp.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchContractPartner,
  fetchInstalments,
  fetchPartnerEvents,
  INSTALMENT_PAGE,
  ledgerKeys,
  postponeInstalment,
  recordEvent,
  remindInstalment,
  settleInstalment,
  voidEvent,
} from "../api";

/** Sự kiện sổ của một đối tác (khối cờ đỏ ở Hồ sơ đối tác). */
export const usePartnerEvents = (party: string) =>
  useQuery({
    queryKey: ledgerKeys.events(party),
    queryFn: ({ signal }) => fetchPartnerEvents(party, signal),
  });

/** Đối tác của HĐ (khối "Ghi việc với …" cuối trang HĐ). */
export function useContractPartner(contractId: string, enabled: boolean) {
  return useQuery({
    queryKey: ledgerKeys.partner(contractId),
    queryFn: ({ signal }) => fetchContractPartner(contractId, signal),
    enabled,
  });
}

/** Các đợt chưa xong + sổ sự kiện của một đối tác. */
export function usePartnerLedger(party: string, contractId?: string) {
  const obs = useInfiniteQuery({
    queryKey: ledgerKeys.instalments(party, contractId),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchInstalments(party, contractId, pageParam, signal),
    // limit+1: đủ cỡ trang + 1 hàng ⇒ còn trang sau.
    getNextPageParam: (last, all) =>
      last.length > INSTALMENT_PAGE ? all.length * INSTALMENT_PAGE : undefined,
    select: (d) => d.pages.flatMap((p) => p.slice(0, INSTALMENT_PAGE)),
  });
  const evs = useQuery({
    queryKey: ledgerKeys.events(party),
    queryFn: ({ signal }) => fetchPartnerEvents(party, signal),
  });
  return { obs, evs };
}

export function useLedgerWrites() {
  return { settleInstalment, remindInstalment, postponeInstalment, recordEvent, voidEvent };
}
