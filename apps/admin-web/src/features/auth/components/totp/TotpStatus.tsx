// ADM-FR-08 · ms §10.1 · trạng thái 2FA: Chưa bật (nút Bật) / Đã bật (ngày bật, số mã còn lại, Tạo lại, Tắt).
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { formatUpdated } from "@/lib/format";

type Props = {
  enabled: boolean;
  enabledAt: string | null;
  codesLeft: number;
  onEnable: () => void;
  onRegenerate: () => void;
  onDisable: () => void;
};

export function TotpStatus({
  enabled,
  enabledAt,
  codesLeft,
  onEnable,
  onRegenerate,
  onDisable,
}: Props) {
  const { t } = useTranslation();
  if (!enabled) {
    return (
      <div className="space-y-4">
        <StatusBadge tone="off">{t("twofa.off")}</StatusBadge>
        <p className="text-body text-muted-foreground">{t("twofa.intro")}</p>
        <Button type="button" onClick={onEnable}>
          {t("twofa.enable")}
        </Button>
      </div>
    );
  }
  const date = enabledAt ? formatUpdated(enabledAt, null) : "—";
  return (
    <div className="space-y-4">
      <StatusBadge tone="ok">{t("twofa.on")}</StatusBadge>
      <p className="text-body text-muted-foreground">
        {t("twofa.status.since", { date, n: codesLeft })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onRegenerate}>
          {t("twofa.regen.action")}
        </Button>
        <Button type="button" variant="destructive" onClick={onDisable}>
          {t("twofa.disable.action")}
        </Button>
      </div>
    </div>
  );
}
