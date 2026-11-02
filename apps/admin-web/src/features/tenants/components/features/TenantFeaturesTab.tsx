// CR-111 · tab "Feature" của chi tiết công ty (chỉ platform_admin): mỗi app một thẻ chọn mức Tắt/Xem/Sửa/Quản trị + tính năng thêm,
// lưu một lượt bằng diff (cấp/thu hồi entitlement hiện có). Có thu hồi ⇒ hỏi xác nhận. Nạp lười.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { Button } from "@/components/ui/button";
import { loadError } from "@/lib/load-error";
import { useTenantFeatures } from "../../hooks/use-tenant-features";
import { AppCard } from "./AppCard";

type Props = { tenant: { id: string; name: string }; onDirtyChange: (dirty: boolean) => void };

export default function TenantFeaturesTab({ tenant, onDirtyChange }: Props) {
  const { t } = useTranslation();
  const f = useTenantFeatures(tenant, onDirtyChange);
  const [confirm, setConfirm] = useState(false);
  const err = loadError(f.query.error);
  if (err) {
    return (
      <ErrorState message={err.message} code={err.code} onRetry={() => void f.query.refetch()} />
    );
  }
  if (f.query.isPending) return <LoadingState />;
  const revokes = f.diff.revoke.length;
  const requestSave = () => (revokes > 0 ? setConfirm(true) : void f.save());
  return (
    <section aria-label={t("tenants.features.title")} className="space-y-4">
      <div>
        <h2 className="text-h3 font-semibold">{t("tenants.features.title")}</h2>
        <p className="text-caption text-muted-foreground">{t("tenants.features.desc")}</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {f.cards.map((card) => (
          <AppCard key={card.app} card={card} draft={f.value} onChange={f.change} />
        ))}
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <p className="min-w-0 flex-1 text-label text-muted-foreground">
          {f.dirty
            ? t("tenants.features.pending", { grant: f.diff.grant.length, revoke: revokes })
            : t("tenants.features.noChange")}
        </p>
        <Button variant="outline" disabled={!f.dirty || f.saving} onClick={f.reset}>
          {t("tenants.features.reset")}
        </Button>
        <Button disabled={!f.dirty || f.saving} onClick={requestSave}>
          {t("common.save")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("tenants.features.confirmTitle", { tenant: tenant.name })}
        description={t("tenants.features.confirmBody", { count: revokes })}
        confirmLabel={t("common.save")}
        destructive
        onConfirm={f.save}
      />
    </section>
  );
}
