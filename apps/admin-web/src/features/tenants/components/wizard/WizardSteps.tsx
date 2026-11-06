// CR-112 · ADM-FR-79 · thân bước 2-4 của wizard: tái dùng nguyên tab Ứng dụng & Gói, khối vai (RolesPanel) và tóm tắt Tổng quan;
// không có endpoint riêng cho wizard. Bước 2/3 có bản nháp riêng ⇒ nút "Tiếp tục" khoá tới khi lưu xong (không mất nháp âm thầm).
import type { TenantDetail } from "@ai/contracts/tenants";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { TenantOverview } from "../overview/TenantOverview";

const TenantFeaturesTab = lazy(() => import("../features/TenantFeaturesTab"));
const RolesTab = lazy(() => import("@/features/app-roles/components/RolesPanel"));

type Dirty = { onDirtyChange: (dirty: boolean) => void };

export function WizardAppsStep({ tenant, onDirtyChange }: { tenant: TenantDetail } & Dirty) {
  return (
    <Suspense fallback={<LoadingState />}>
      <TenantFeaturesTab tenant={tenant} onDirtyChange={onDirtyChange} />
    </Suspense>
  );
}

export function WizardPeopleStep({ tenant, onDirtyChange }: { tenant: TenantDetail } & Dirty) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-body text-muted-foreground">{t("tenants.wizard.peopleHint")}</p>
      <Link
        to="/tenants/$tenantId"
        params={{ tenantId: tenant.id }}
        search={{ tab: "members", view: "users", drawer: "new" }}
        className="text-label text-primary underline underline-offset-4"
      >
        {t("tenants.wizard.addUsers")}
      </Link>
      <Suspense fallback={<LoadingState />}>
        <RolesTab tenant={tenant} onDirtyChange={onDirtyChange} />
      </Suspense>
    </div>
  );
}

export function WizardReviewStep({ tenant }: { tenant: TenantDetail }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-body text-muted-foreground">
        {t("tenants.wizard.reviewHint", { name: tenant.name })}
      </p>
      <TenantOverview tenant={tenant} />
    </div>
  );
}
