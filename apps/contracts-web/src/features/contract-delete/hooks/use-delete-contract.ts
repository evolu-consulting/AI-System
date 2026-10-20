// V2-M · xem trước tác động (chỉ khi mở hộp) + mutation xoá hợp đồng; xoá xong làm mới mọi truy vấn và về danh sách.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { deleteContract, deleteImpactKey, fetchDeleteImpact } from "../api";

export function useDeleteContract(id: string, open: boolean, close: () => void) {
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
    mutationFn: () => deleteContract(id),
    onSuccess: async () => {
      toast(t("contracts.del.done"));
      close();
      await qc.invalidateQueries();
      await nav({ to: "/contracts" });
    },
    onError: () => toast(t("contracts.del.failed"), "late"),
  });
  return { impact, del };
}
