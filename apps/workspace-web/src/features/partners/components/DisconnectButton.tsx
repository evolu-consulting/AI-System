// CR-161 · «Ngắt kết nối»: hộp xác nhận nguy hiểm — nói rõ nối lại phải mời mới, tin cũ giữ lại chỉ đọc.
import { toast } from "@ai/web-kit/ui/toast";
import { Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { Btn } from "~/components/ui/Btn";
import { errCodeOf, useConnectWrites } from "../hooks/use-connect";
import { connectErrKey } from "../lib/connect";

export function DisconnectButton({ tenant, name }: { tenant: string; name: string }) {
  const { t } = useTranslation();
  const { disconnect } = useConnectWrites();
  const go = async () => {
    const ok = await confirmDialog({
      title: t("contracts.connect.disconnect.title", { name }),
      body: t("contracts.connect.disconnect.body"),
      confirmLabel: t("contracts.connect.disconnect.confirm"),
      cancelLabel: t("contracts.connect.disconnect.keep"),
      danger: true,
    });
    if (!ok) return;
    disconnect.mutate(tenant, {
      onSuccess: () => toast(t("contracts.connect.disconnect.done", { name })),
      onError: (e) => toast(t(`contracts.connect.err.${connectErrKey(errCodeOf(e))}`), "late"),
    });
  };
  return (
    <Btn
      size="sm"
      variant="quiet"
      loading={disconnect.isPending}
      onClick={() => void go()}
      aria-label={t("contracts.connect.disconnect.aria", { name })}
    >
      <Unlink className="size-4" aria-hidden="true" />
      {t("contracts.connect.disconnect.button")}
    </Btn>
  );
}
