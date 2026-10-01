// ADM-FR-31 · "+ Cấp cho tenant": chọn tenant chưa được cấp (tenant khoá vẫn cấp được) → `PUT` entitlement.
import { useTranslation } from "react-i18next";
import { RefPicker } from "@/components/shared/RefPicker";
import { useGrantedTenantIds, useTenantOptions } from "../hooks/use-feature-queries";

type Props = { featureId: string; onGrant: (tenant: { id: string; key: string }) => void };

export function GrantPicker({ featureId, onGrant }: Props) {
  const { t } = useTranslation();
  const tenants = useTenantOptions(true);
  const granted = useGrantedTenantIds(featureId);
  const grantedIds = (granted.data?.items ?? []).map((e) => e.tenant_id);
  const options = (tenants.data ?? []).map((x) => ({
    id: x.id,
    label: x.key,
    hint: x.locked ? `${x.name} · ${t("commands.access.tenantLocked")}` : x.name,
  }));
  return (
    <div className="space-y-1">
      <RefPicker
        trigger="button"
        label={t("features.tenants.grant")}
        placeholder={t("common.search")}
        options={options}
        selectedIds={grantedIds}
        isLoading={tenants.isPending || granted.isPending}
        onPick={(id) => {
          const x = tenants.data?.find((o) => o.id === id);
          if (x) onGrant({ id: x.id, key: x.key });
        }}
      />
      {options.length > 0 && options.every((o) => grantedIds.includes(o.id)) ? (
        <p className="text-caption text-muted-foreground">{t("features.tenants.pickerEmpty")}</p>
      ) : null}
    </div>
  );
}
