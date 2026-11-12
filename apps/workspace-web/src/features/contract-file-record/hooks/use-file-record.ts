// CR-135 · Q5 · cổng hook cho ngăn «Hồ sơ» (component-no-fetch): dùng LẠI các truy vấn sẵn có (cùng khoá ⇒ chung bộ nhớ đệm với trang chi tiết).
import { useQuery } from "@tanstack/react-query";
import { approvalKey, fetchApproval } from "~/features/contract-approval/api";
import { fetchApprovalRecord, recordKey } from "~/features/contract-approval/api-record";
import { recordLines } from "~/features/contract-approval/lib/record-view";
import { esignKey, fetchEsign, signedLink } from "~/features/contract-esign/api";
import { contractKey, fetchContract } from "~/features/contract-review/api";
import { fetchMembers, MEMBERS_KEY } from "~/features/contracts-list/api";

export function useFileRecord(contractId: string) {
  const detail = useQuery({
    queryKey: contractKey(contractId),
    queryFn: ({ signal }) => fetchContract(contractId, signal),
    staleTime: 30_000,
  });
  const members = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: ({ signal }) => fetchMembers(signal),
    staleTime: 5 * 60_000,
  });
  const record = useQuery({
    queryKey: recordKey(contractId),
    queryFn: ({ signal }) => fetchApprovalRecord(contractId, signal),
    retry: false,
    staleTime: 30_000,
  });
  const esign = useQuery({
    queryKey: esignKey(contractId),
    queryFn: ({ signal }) => fetchEsign(contractId, signal),
    retry: false,
    staleTime: 30_000,
  });
  const card = useQuery({
    queryKey: approvalKey(contractId),
    queryFn: ({ signal }) => fetchApproval(contractId, signal),
    retry: false,
    staleTime: 30_000,
  });
  const lines = record.data ? recordLines(record.data, card.data?.steps) : [];
  const openSigned = async (): Promise<void> => {
    const { url } = await signedLink(contractId);
    window.open(url, "_blank", "noopener");
  };
  return { detail, members: members.data?.items, record, esign, lines, openSigned };
}
