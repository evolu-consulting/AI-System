// ADM-FR-35 · M3-R08 · thanh trên ma trận: "{n} thay đổi chưa lưu" (status) · Huỷ · Lưu; quá 200 thao tác → chặn Lưu kèm câu giải thích.
import { GRANT_BATCH_MAX } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/components/shared/ConnectionBanner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Props = {
  count: number;
  pending: boolean;
  unopenedCount: number;
  showUnopened: boolean;
  onShowUnopened: (v: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function MatrixToolbar(p: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const tooMany = p.count > GRANT_BATCH_MAX;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h2 className="text-label font-semibold">{t("access.matrix.title")}</h2>
      {p.unopenedCount > 0 ? (
        <div className="flex items-center gap-2">
          <Switch id="show-unopened" checked={p.showUnopened} onCheckedChange={p.onShowUnopened} />
          <Label htmlFor="show-unopened" className="text-caption font-normal">
            {t("access.matrix.showUnopened", { count: p.unopenedCount })}
          </Label>
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-3">
        {p.count > 0 ? (
          <p role="status" className="text-label text-muted-foreground">
            {t("access.matrix.dirty", { count: p.count })}
          </p>
        ) : null}
        <Button variant="outline" disabled={p.count === 0 || p.pending} onClick={p.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button disabled={p.count === 0 || tooMany || p.pending || !online} onClick={p.onSave}>
          {t("common.save")}
        </Button>
      </div>
      {tooMany ? (
        <p role="alert" className="w-full text-caption text-destructive">
          {t("access.matrix.tooMany", { count: p.count })}
        </p>
      ) : null}
    </div>
  );
}
