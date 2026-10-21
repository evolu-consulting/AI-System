// portal-home · mỗi nguồn một query độc lập, không retry: một thẻ lỗi không chặn trang (fail-soft, số chỉ ẩn đi).
import type { MeApp } from "@ai/contracts";
import {
  adminNumbers,
  contractsNumbers,
  recentConversations,
} from "@ai/web-kit/app-catalog/portal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listConversations } from "~/features/conversations/api";
import { session } from "~/lib/auth/session";
import { fetchContractsTodo, fetchPortal, putMyDefaultApp, putTenantDefaultApp } from "../api";

const KEY = "portal";
const soft = { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } as const;

export function usePortalApps(userId: string | undefined) {
  return useQuery({
    queryKey: [KEY, "apps", userId],
    queryFn: () => session.myApps().then((r) => r.items),
    ...soft,
  });
}

export function usePortalInfo() {
  return useQuery({
    queryKey: [KEY, "info"],
    queryFn: ({ signal }) => fetchPortal(signal),
    ...soft,
  });
}

/** Chỉ hỏi khi người dùng có Sổ Hợp Tác trong danh sách app. */
export function useContractsNumbers(apps: readonly MeApp[] | undefined) {
  const on = !!apps?.some((a) => a.key === "contracts");
  return useQuery({
    queryKey: [KEY, "contracts"],
    queryFn: ({ signal }) => fetchContractsTodo(signal).then(contractsNumbers),
    enabled: on,
    ...soft,
  });
}

export function useRecentChats() {
  return useQuery({
    queryKey: [KEY, "recent"],
    queryFn: ({ signal }) =>
      listConversations("", undefined, signal).then((p) => recentConversations(p.items)),
    ...soft,
  });
}

export const useAdminNumbers = () => {
  const q = usePortalInfo();
  return adminNumbers(q.data);
};

export function useSetDefaultApp(scope: "user" | "tenant") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (app: string | null) =>
      scope === "user" ? putMyDefaultApp({ app }) : putTenantDefaultApp({ app }),
    onSuccess: (data) => qc.setQueryData([KEY, "info"], data),
  });
}
