// V2-M · xem trước tác động (chỉ khi mở hộp) + mutation xoá hợp đồng; xoá xong làm mới mọi truy vấn.
// `goList`: true (trang chi tiết) ⇒ về danh sách; false (xoá từ danh sách) ⇒ ở lại danh sách.

import { ApiError } from "@ai/web-kit/http";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { deleteContract, deleteImpactKey, fetchDeleteImpact } from "../api";

export function useDeleteContract(id: string, open: boolean, close: () => void, goList = true) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nav = useNavigate();
  const impact = useQuery({
    queryKey: deleteImpactKey(id),
    queryFn: ({ signal }) => fetchDeleteImpact(id, signal),
    enabled: open,
    gcTime: 0,
  });
  const del = useMutation({
    mutationFn: (removeProducts: string[]) => deleteContract(id, removeProducts),
    onSuccess: async () => {
      toast(t("contracts.del.done"));
      close();
      await qc.invalidateQueries();
      if (goList) await nav({ to: "/contracts" });
    },
    onError: (e) =>
      toast(
        e instanceof ApiError && (e.code as string) === "CONTRACT_HAS_VERSIONS"
          ? t("contracts.del.hasVersions")
          : t("contracts.del.failed"),
        "late",
      ),
  });
  return { impact, del };
}
