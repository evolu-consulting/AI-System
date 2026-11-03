// CR-112 · tab Tổng quan + bước Xem lại của wizard · gộp 3 GET có sẵn (feature, vai, quota) — mọi route đều cho tenant_admin công ty mình.
import { useMemo } from "react";
import { useTenantFeatureStates, useTenantQuotas } from "../api";
import { useTenantAppRoles } from "../api-apps";
import { buildCards, entitledKeys } from "../lib/feature-assign";
import { appsOn, tenantQuotaRow } from "../lib/overview";

export function useTenantOverview(tenantId: string) {
  const features = useTenantFeatureStates(tenantId, true);
  const roles = useTenantAppRoles(tenantId, true);
  const quotas = useTenantQuotas(tenantId, true);
  const apps = useMemo(
    () =>
      features.data ? appsOn(buildCards(features.data), entitledKeys(features.data)) : undefined,
    [features.data],
  );
  const error = features.error ?? roles.error ?? quotas.error;
  return {
    apps,
    roleCount: roles.data?.items.length,
    quota: quotas.data ? tenantQuotaRow(quotas.data.items) : undefined,
    month: quotas.data?.month,
    pending: features.isPending || roles.isPending || quotas.isPending,
    error,
    refetch: () => {
      void features.refetch();
      void roles.refetch();
      void quotas.refetch();
    },
  };
}
