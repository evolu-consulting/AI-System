// gap-a1 · thao tác trên trang chi tiết HĐ: AI đọc lại, giao người phụ trách, sửa hoa hồng %, tạo tóm tắt AI. Mỗi thao tác = một mutation,
// xong thì làm mới chi tiết (kéo theo lịch sử) và báo toast; lỗi ⇒ toast câu theo mã máy chủ.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { fetchMembers, MEMBERS_KEY } from "~/features/contracts-list/api";
import {
  ASSIGNEES_KEY,
  assignOwner,
  contractKey,
  editCommission,
  extractContract,
  fetchAssignees,
  fetchHistory,
  generateSummary,
  historyKey,
} from "../api";
import { manageErrorKey } from "../lib/manage";

function useAction<A>(
  id: string,
  run: (a: A) => Promise<unknown>,
  okKey: string,
  after?: () => void,
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      toast(t(okKey));
      after?.();
      await qc.invalidateQueries({ queryKey: contractKey(id) });
    },
    onError: (e) => toast(t(manageErrorKey(e)), "late"),
  });
}

export const useReextract = (id: string, after?: () => void) =>
  useAction(id, () => extractContract(id), "contracts.gapa1.reextract.started", after);

export const useAssignOwner = (id: string) =>
  useAction(id, (owner: string | null) => assignOwner(id, owner), "contracts.gapa1.owner.saved");

export const useEditCommission = (id: string, version: number) =>
  useAction(
    id,
    (pct: number | null) => editCommission(id, version, pct),
    "contracts.gapa1.commission.saved",
  );

export const useGenerateSummary = (id: string) =>
  useAction(id, () => generateSummary(id), "contracts.gapa1.summary.done");

/** Người có thể được giao (chỉ khi được ghi). */
export function useAssignees(enabled: boolean) {
  return useQuery({
    queryKey: ASSIGNEES_KEY,
    queryFn: ({ signal }) => fetchAssignees(signal),
    enabled,
    staleTime: 60_000,
  });
}

/** Danh bạ tên người (đọc được mọi vai) — tên người phụ trách + người làm trong lịch sử. */
export function useMemberNames(): (id: string | null) => string | null {
  const q = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: ({ signal }) => fetchMembers(signal),
    staleTime: 60_000,
  });
  const names = new Map((q.data?.items ?? []).map((m) => [m.id, m.name]));
  return (id) => (id ? (names.get(id) ?? null) : null);
}

export function useHistory(id: string, enabled: boolean) {
  return useQuery({
    queryKey: historyKey(id),
    queryFn: ({ signal }) => fetchHistory(id, signal),
    enabled,
  });
}
