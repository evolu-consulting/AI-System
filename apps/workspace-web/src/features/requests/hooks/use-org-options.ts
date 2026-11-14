// CR-125 · cr125-manual-start-ui · lựa chọn phòng ban (người: hộp tìm ở máy chủ, CR-151) cho ô «Người» / «Phòng ban» của phiếu (cơ cấu `/admin/org`); lỗi quyền ⇒ rỗng + báo.
import { useQuery } from "@tanstack/react-query";
import { fetchOrg, orgKeys } from "~/features/org/api";

export type OrgOption = { value: string; label: string };

export function useOrgOptions(enabled: boolean): {
  departments: OrgOption[];
  failed: boolean;
} {
  const q = useQuery({
    queryKey: orgKeys.org,
    queryFn: ({ signal }) => fetchOrg(signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  return {
    departments: (q.data?.departments ?? []).map((d) => ({ value: d.group_id, label: d.name })),
    failed: q.isError,
  };
}
