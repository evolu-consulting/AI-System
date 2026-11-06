// CR-112 · ADM-FR-78 · thanh lưu dính đáy của tab "Ứng dụng & Gói": tóm tắt thay đổi chưa lưu (cấp/thu hồi + gói) + Hoàn tác + Lưu.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AppsPlan } from "../../lib/apps-plan";

type Props = {
  plan: AppsPlan;
  dirty: boolean;
  saving: boolean;
  onReset: () => void;
  onSave: () => void;
};

export function AppsSaveBar({ plan, dirty, saving, onReset, onSave }: Props) {
  const { t } = useTranslation();
  const packs = { on: plan.enablePacks.length, off: plan.disablePacks.length };
  const pending =
    t("tenants.features.pending", { grant: plan.grant.length, revoke: plan.revokeShown.length }) +
    (packs.on + packs.off > 0 ? ` · ${t("tenants.apps.pendingPacks", packs)}` : "");
  // Chỉ hiện khi có thay đổi (giống tab Cài đặt): không còn thanh "Chưa có thay đổi" thường trực.
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <p className="min-w-0 flex-1 text-label text-muted-foreground">{pending}</p>
      <Button variant="outline" disabled={saving} onClick={onReset}>
        {t("common.cancel")}
      </Button>
      <Button disabled={saving} onClick={onSave}>
        {t("common.save")}
      </Button>
    </div>
  );
}
