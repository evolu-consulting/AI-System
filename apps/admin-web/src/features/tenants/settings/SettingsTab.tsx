// CR-121 c14b · R2 · tab Cài đặt (artboard Tpl-Settings): Mã công ty (chép được), Múi giờ, Chạy cùng lúc (TenantInfoForm), ứng dụng mặc định,
// Quota (#quota), Khoá công ty. MỘT thanh lưu chung "Có thay đổi chưa lưu · Huỷ · Lưu" cho cả form Thông tin và form Quota; công ty đang khoá ⇒ banner.
// Chỉ platform_admin sửa/khoá; tenant_admin xem (Quota rút gọn, không tiền).
import type { TenantDetail } from "@ai/contracts/tenants";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/components/shared/ConnectionBanner";
import { Button } from "@/components/ui/button";
import { TenantQuotaReadonly } from "../components/quota/TenantQuotaReadonly";
import { TenantQuotaTab } from "../components/quota/TenantQuotaTab";
import { TenantDefaultAppCard } from "../components/TenantDefaultAppCard";
import { TenantInfoForm } from "../components/TenantInfoForm";
import type { TenantInfoValues } from "../lib/schemas";
import { saveOrder } from "./save-order";

const INFO_FORM = "settings-info-form";
const QUOTA_FORM = "settings-quota-form";

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

function LockedBanner({ tenant, isPlatform }: { tenant: TenantDetail; isPlatform: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid="settings-locked-banner"
      className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-body"
    >
      <p className="font-semibold">{t("tenants.settings.lockedBanner")}</p>
      <p className="text-caption text-muted-foreground">
        {t(
          isPlatform ? "tenants.settings.lockedWho.platform" : "tenants.settings.lockedWho.tenant",
        )}
        {tenant.updated_by ? ` ${t("tenants.settings.lockedBy", { by: tenant.updated_by })}` : ""}
      </p>
    </div>
  );
}

function LockSection(p: { locked: boolean; onLock: () => void; onUnlock: () => void }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("tenants.settings.lockTitle")} className="space-y-2">
      <h2 className="text-h3 font-semibold">{t("tenants.settings.lockTitle")}</h2>
      <p className="text-caption text-muted-foreground">
        {t(p.locked ? "tenants.settings.lockedNote" : "tenants.settings.lockNote")}
      </p>
      <Button
        variant={p.locked ? "outline" : "destructive"}
        data-testid="settings-lock"
        onClick={p.locked ? p.onUnlock : p.onLock}
      >
        {t(p.locked ? "tenants.unlock.button" : "tenants.lock.button")}
      </Button>
    </section>
  );
}

function SaveBar(p: {
  both: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="settings-savebar"
      className="fixed right-0 bottom-0 left-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-drawer lg:left-sidebar"
    >
      <span className="text-label text-muted-foreground">
        {t(p.both ? "tenants.settings.unsavedBoth" : "common.unsaved")}
      </span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={p.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="button" data-testid="settings-save" disabled={p.disabled} onClick={p.onSave}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

export function SettingsTab(p: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const quotaRef = useRef<HTMLElement>(null);
  const [infoDirty, setInfoDirty] = useState(false);
  const [quotaDirty, setQuotaDirty] = useState(false);
  // Huỷ ⇒ dựng lại hai form từ dữ liệu server (về trạng thái sạch).
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (p.scrollToQuota) quotaRef.current?.scrollIntoView({ block: "start" });
  }, [p.scrollToQuota]);
  const canLock = p.isPlatform && p.tenant.key !== "platform";
  const locked = p.tenant.status === "locked";
  const dirty = p.isPlatform && (infoDirty || quotaDirty);
  const both = infoDirty && quotaDirty;
  const save = () => {
    const first = saveOrder({ info: infoDirty, quota: quotaDirty })[0];
    const id = first === "info" ? INFO_FORM : QUOTA_FORM;
    (document.getElementById(id) as HTMLFormElement | null)?.requestSubmit();
  };
  return (
    <div className="space-y-8 pb-20" data-testid="settings-tab">
      {locked ? <LockedBanner tenant={p.tenant} isPlatform={p.isPlatform} /> : null}
      <section className="space-y-4">
        <TenantInfoForm
          key={`info-${resetKey}`}
          formId={INFO_FORM}
          hideBar
          readOnly={!p.isPlatform}
          tenant={p.tenant}
          pending={p.pending}
          timezoneError={p.timezoneError}
          onDirtyChange={(d) => {
            setInfoDirty(d);
            p.onInfoDirty(d);
          }}
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
            key={`quota-${resetKey}`}
            formId={QUOTA_FORM}
            hideBar
            tenant={p.tenant}
            onDirtyChange={(d) => {
              setQuotaDirty(d);
              p.onQuotaDirty(d);
            }}
            onReloadTenant={p.onReloadTenant}
          />
        ) : (
          <TenantQuotaReadonly tenantId={p.tenant.id} />
        )}
      </section>
      {canLock ? <LockSection locked={locked} onLock={p.onLock} onUnlock={p.onUnlock} /> : null}
      {dirty ? (
        <SaveBar
          both={both}
          disabled={p.pending || !online}
          onCancel={() => setResetKey((k) => k + 1)}
          onSave={save}
        />
      ) : null}
    </div>
  );
}
