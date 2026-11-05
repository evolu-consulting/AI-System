// V2-H · "Nhắc gia hạn": tạo việc "Liên hệ mời gia hạn" trong Cần xử lý của mình, rồi làm mới tab khách + Cần xử lý.
import type { ServiceCustomer } from "@ai/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { customersKey, remindRenewal } from "../api";

export function useRemind(productId: string, c: Pick<ServiceCustomer, "id" | "customer_name">) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => remindRenewal(productId, c.id),
    onSuccess: async () => {
      toast(t("contracts.svc.toast", { name: c.customer_name ?? t("contracts.svc.someone") }));
      await qc.invalidateQueries({ queryKey: customersKey(productId) });
      await qc.invalidateQueries({ queryKey: ["my-work"] });
    },
    onError: () => toast(t("contracts.errors.unknown"), "late"),
  });
}
