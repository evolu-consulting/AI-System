// V2-N · dữ liệu khối Tổng quan: "Cần xử lý" (đọc + Bỏ qua/Đã xong) và khối Hợp đồng (facets + HĐ sắp hết hiệu lực).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { FACETS_KEY, fetchFacets, fetchList, listKey } from "~/features/contracts-list/api";
import { dismissTodo, fetchMyWork, fetchTodo, overviewKeys } from "../api";
import { EXPIRING_QS } from "../lib/overview";

export const useTodo = () =>
  useQuery({ queryKey: overviewKeys.todo, queryFn: ({ signal }) => fetchTodo(signal) });

export const useMyApprovals = () =>
  useQuery({ queryKey: overviewKeys.approvals, queryFn: ({ signal }) => fetchMyWork(signal) });

export function useDismissTodo() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; action: "skip" | "done" }) => dismissTodo(v.key, v.action),
    onSuccess: async (_r, v) => {
      toast(
        t(
          v.action === "done"
            ? "contracts.overview.todo.toastDone"
            : "contracts.overview.todo.toastSkip",
        ),
      );
      await qc.invalidateQueries({ queryKey: overviewKeys.todo });
      await qc.invalidateQueries({ queryKey: ["my-work"] });
    },
    onError: () => toast(t("contracts.errors.unknown"), "late"),
  });
}

export const useContractFacets = () =>
  useQuery({ queryKey: FACETS_KEY, queryFn: ({ signal }) => fetchFacets(signal) });

export const useExpiringContracts = () =>
  useQuery({
    queryKey: listKey(EXPIRING_QS),
    queryFn: ({ signal }) => fetchList(EXPIRING_QS, signal),
  });
