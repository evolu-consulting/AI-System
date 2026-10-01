// ADM-FR-31 · M2-R22 · tab "Tenant": entitlement của feature (lưu ngay từng thao tác), cấp / thu hồi (Hoàn tác 5 s); `core` = "Mọi tenant".
import type { Entitlement, FeatureDetail } from "@ai/contracts";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { ENTITLEMENTS_PAGE_SIZE, useEntitlements } from "../api";
import { useEntitlementActions } from "../hooks/use-entitlement-actions";
import { GrantPicker } from "./GrantPicker";
import { RevokeDialog } from "./RevokeDialog";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function FeatureTenantsTab({ feature }: { feature: FeatureDetail }) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const list = useEntitlements(feature.is_core ? undefined : feature.id, offset);
  const actions = useEntitlementActions(feature);
  const columns = useMemo<Column<Entitlement>[]>(
    () => [
      {
        id: "key",
        header: t("features.tenants.col.key"),
        cell: (e) => <span className="font-mono">{e.tenant_key}</span>,
      },
      {
        id: "name",
        header: t("features.tenants.col.name"),
        cell: (e) => (
          <span className="flex items-center gap-2">
            {e.tenant_name}{" "}
            {e.tenant_active ? null : (
              <StatusBadge tone="err">{t("commands.access.tenantLocked")}</StatusBadge>
            )}
          </span>
        ),
      },
      { id: "users", header: t("features.tenants.col.users"), cell: (e) => e.active_user_count },
      {
        id: "grantedAt",
        header: t("features.tenants.col.grantedAt"),
        cell: (e) => fmtDate(e.granted_at),
      },
      {
        id: "grantedBy",
        header: t("features.tenants.col.grantedBy"),
        cell: (e) => e.granted_by ?? "",
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        className: "w-28 text-right",
        cell: (e) => (
          <Button variant="outline" size="sm" onClick={() => actions.askRevoke(e)}>
            {t("features.tenants.revoke")}
          </Button>
        ),
      },
    ],
    [t, actions.askRevoke],
  );

  if (feature.is_core) {
    return <p className="text-body text-muted-foreground">{t("features.tenants.coreAll")}</p>;
  }
  const err = list.error instanceof ApiError ? list.error : null;
  return (
    <div className="space-y-4">
      <GrantPicker featureId={feature.id} onGrant={actions.grant} />
      <DataTable
        caption={t("features.tab.tenants")}
        columns={columns}
        rows={list.data?.items}
        getRowKey={(e) => e.tenant_id}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={<EmptyState message={t("features.tenants.empty")} />}
      />
      <Pagination
        offset={offset}
        limit={ENTITLEMENTS_PAGE_SIZE}
        total={list.data?.total ?? 0}
        onOffsetChange={setOffset}
      />
      <RevokeDialog
        target={actions.target}
        onClose={actions.closeRevoke}
        onConfirm={actions.revoke}
      />
    </div>
  );
}
