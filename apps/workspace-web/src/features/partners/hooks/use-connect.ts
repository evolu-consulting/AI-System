// CR-161 · truy vấn/ghi «kết nối hai công ty». Mọi ghi làm mới khoá `connect` + danh sách đối tác.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptLink,
  connectKeys,
  declineLink,
  disconnectLink,
  fetchCompany,
  fetchLinks,
  fetchSettings,
  inviteCompany,
  saveSettings,
  searchCompanies,
  withdrawInvite,
} from "../api.connect";
import { searchReady } from "../lib/connect";

export { errCodeOf } from "./use-partner-rep";

/** BR-191-10/11: mọi người xem được danh sách; chỉ ghi (đồng ý, từ chối, thu hồi, ngắt) bị khoá theo vai. */
export const useLinks = (status: "connected" | "pending_in" | "pending_out", enabled = true) =>
  useQuery({
    queryKey: connectKeys.links(status),
    queryFn: ({ signal }) => fetchLinks(status, signal),
    enabled,
    retry: false,
    staleTime: 15_000,
  });

/** BR-191-11 · cài đặt «Ai được tìm và mời đối tác mới» + «tôi có được mời không». */
export const useConnectSettings = () =>
  useQuery({
    queryKey: connectKeys.settings,
    queryFn: ({ signal }) => fetchSettings(signal),
    retry: false,
    staleTime: 15_000,
  });

/** BR-191-9 · trang công ty (không có bài). */
export const useCompanyPage = (id: string) =>
  useQuery({
    queryKey: connectKeys.company(id),
    queryFn: ({ signal }) => fetchCompany(id, signal),
    retry: false,
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
    withdraw: useMutation({ mutationFn: withdrawInvite, onSuccess: done }),
    setInviteBy: useMutation({ mutationFn: saveSettings, onSuccess: done }),
  };
}
