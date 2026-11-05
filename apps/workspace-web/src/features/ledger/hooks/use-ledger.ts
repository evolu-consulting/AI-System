// HD7-FR-04…12: truy vấn + lệnh ghi của sổ đối tác — component không gọi api.ts trực tiếp.
import { useQuery } from "@tanstack/react-query";
import {
  fetchContractPartner,
  fetchInstalments,
  fetchPartnerEvents,
  ledgerKeys,
  postponeInstalment,
  recordEvent,
  remindInstalment,
  settleInstalment,
  voidEvent,
} from "../api";

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
  const obs = useQuery({
    queryKey: ledgerKeys.instalments(party, contractId),
    queryFn: ({ signal }) => fetchInstalments(party, contractId, signal),
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
