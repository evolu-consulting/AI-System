// CR-121 c14 · R2 · tab Cài đặt: Mã công ty, Múi giờ, Chạy cùng lúc (TenantInfoForm, một thanh lưu), ứng dụng mặc định, Quota (#quota),
// Khoá công ty. Chỉ platform_admin sửa/khoá; tenant_admin xem (Quota rút gọn, không tiền).
import type { TenantDetail } from "@ai/contracts/tenants";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TenantQuotaReadonly } from "../components/quota/TenantQuotaReadonly";
import { TenantQuotaTab } from "../components/quota/TenantQuotaTab";
import { TenantDefaultAppCard } from "../components/TenantDefaultAppCard";
import { TenantInfoForm } from "../components/TenantInfoForm";
import type { TenantInfoValues } from "../lib/schemas";

type Props = {
  tenant: TenantDetail;
  isPlatform: boolean;
  pending: boolean;
  timezoneError?: string | undefined;
  /** `at=quota` ⇒ cuộn tới phần Quota (URL cũ `?tab=quota`). */
  scrollToQuota: boolean;
  onInfoDirty: (d: boolean) => void;
  onQuotaDirty: (d: boolean) => void;
  onSubmit: (v: TenantInfoValues) => void;
  onReloadTenant: () => void;
  onLock: () => void;
  onUnlock: () => void;
};

export function SettingsTab(p: Props) {
  const { t } = useTranslation();
  const quotaRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (p.scrollToQuota) quotaRef.current?.scrollIntoView({ block: "start" });
  }, [p.scrollToQuota]);
  const canLock = p.isPlatform && p.tenant.key !== "platform";
  const locked = p.tenant.status === "locked";
  return (
    <div className="space-y-8" data-testid="settings-tab">
      <section className="space-y-4">
        <TenantInfoForm
          readOnly={!p.isPlatform}
          tenant={p.tenant}
          pending={p.pending}
          timezoneError={p.timezoneError}
          onDirtyChange={p.onInfoDirty}
          onSubmit={p.onSubmit}
        />
        {p.isPlatform ? <TenantDefaultAppCard tenant={p.tenant} /> : null}
      </section>
      <section
        id="quota"
        ref={quotaRef}
        aria-label={t("tenants.settings.quota")}
        className="space-y-3"
      >
        <h2 className="text-h3 font-semibold">{t("tenants.settings.quota")}</h2>
        {p.isPlatform ? (
          <TenantQuotaTab
            tenant={p.tenant}
            onDirtyChange={p.onQuotaDirty}
            onReloadTenant={p.onReloadTenant}
          />
        ) : (
          <TenantQuotaReadonly tenantId={p.tenant.id} />
        )}
      </section>
      {canLock ? (
        <section aria-label={t("tenants.settings.lockTitle")} className="space-y-2">
          <h2 className="text-h3 font-semibold">{t("tenants.settings.lockTitle")}</h2>
          <p className="text-caption text-muted-foreground">
            {t(locked ? "tenants.settings.lockedNote" : "tenants.settings.lockNote")}
          </p>
          <Button
            variant={locked ? "outline" : "destructive"}
            data-testid="settings-lock"
            onClick={locked ? p.onUnlock : p.onLock}
          >
            {t(locked ? "tenants.unlock.button" : "tenants.lock.button")}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
