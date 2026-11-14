// CR-161 · truy vấn/ghi «kết nối hai công ty». Mọi ghi làm mới khoá `connect` + danh sách đối tác.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptLink,
  connectKeys,
  declineLink,
  disconnectLink,
  fetchLinks,
  inviteCompany,
  searchCompanies,
} from "../api.connect";
import { searchReady } from "../lib/connect";

export { errCodeOf } from "./use-partner-rep";

/** `enabled=false` cho nhân viên không Toàn quyền (API trả 403). */
export const useLinks = (status: "connected" | "pending_in", enabled: boolean) =>
  useQuery({
    queryKey: connectKeys.links(status),
    queryFn: ({ signal }) => fetchLinks(status, signal),
    enabled,
    retry: false,
    staleTime: 15_000,
  });

export const useCompanySearch = (q: string) =>
  useQuery({
    queryKey: connectKeys.search(q.trim()),
    queryFn: ({ signal }) => searchCompanies(q.trim(), signal),
    enabled: searchReady(q),
    retry: false,
  });

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: connectKeys.all });
    void qc.invalidateQueries({ queryKey: ["partners"] });
  };
}

export function useConnectWrites() {
  const done = useRefresh();
  return {
    invite: useMutation({ mutationFn: inviteCompany, onSuccess: done }),
    accept: useMutation({ mutationFn: acceptLink, onSuccess: done }),
    decline: useMutation({ mutationFn: declineLink, onSuccess: done }),
    disconnect: useMutation({ mutationFn: disconnectLink, onSuccess: done }),
  };
}
