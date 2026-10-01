// ADM-FR-60 · bảng Tenants: mã công ty (mono, link), tên, users, slot, trạng thái, menu `⋯` (Mở / Khoá / Mở khoá).
import type { Tenant } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Translate } from "@/lib/format";

type TenantAction = (t: Tenant) => void;

type Props = {
  tenants: Tenant[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onLock: TenantAction;
  onUnlock: TenantAction;
};

const isPlatform = (t: Tenant) => t.key === "platform";

function KeyCell({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2">
      <Link
        to="/tenants/$tenantId"
        params={{ tenantId: tenant.id }}
        className="font-mono text-primary hover:underline"
      >
        {tenant.key}
      </Link>
      {isPlatform(tenant) ? (
        <StatusBadge tone="info">{t("tenants.badge.platform")}</StatusBadge>
      ) : null}
    </span>
  );
}

function StatusCell({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation();
  return tenant.status === "locked" ? (
    <StatusBadge tone="err">{t("tenants.status.locked")}</StatusBadge>
  ) : (
    <StatusBadge tone="ok">{t("tenants.status.active")}</StatusBadge>
  );
}

function RowMenu({
  tenant,
  onLock,
  onUnlock,
}: {
  tenant: Tenant;
  onLock: TenantAction;
  onUnlock: TenantAction;
}) {
  const { t } = useTranslation();
  const locked = tenant.status === "locked";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/tenants/$tenantId" params={{ tenantId: tenant.id }}>
            {t("tenants.menu.open")}
          </Link>
        </DropdownMenuItem>
        {isPlatform(tenant) ? null : (
          <DropdownMenuItem onSelect={() => (locked ? onUnlock(tenant) : onLock(tenant))}>
            {t(locked ? "tenants.menu.unlock" : "tenants.menu.lock")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Định nghĩa cột (hàm thuần theo `t` và hai callback ổn định) để `useMemo` ở nơi dùng. */
export function tenantColumns(
  t: Translate,
  onLock: TenantAction,
  onUnlock: TenantAction,
): Column<Tenant>[] {
  return [
    { id: "key", header: t("tenants.col.key"), cell: (r) => <KeyCell tenant={r} /> },
    { id: "name", header: t("tenants.col.name"), cell: (r) => r.name },
    { id: "users", header: t("tenants.col.users"), cell: (r) => r.user_count },
    {
      id: "slots",
      header: t("tenants.col.slots"),
      cell: (r) => r.max_concurrent_sub ?? t("common.unlimited"),
    },
    { id: "status", header: t("tenants.col.status"), cell: (r) => <StatusCell tenant={r} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("common.actions")}</span>,
      className: "w-12 text-right",
      cell: (r) => <RowMenu tenant={r} onLock={onLock} onUnlock={onUnlock} />,
    },
  ];
}

export function TenantTable({
  tenants,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onLock,
  onUnlock,
}: Props) {
  const { t } = useTranslation();
  const columns = useMemo(
    () => tenantColumns(t as unknown as Translate, onLock, onUnlock),
    [t, onLock, onUnlock],
  );
  return (
    <DataTable
      caption={t("tenants.list.title")}
      columns={columns}
      rows={tenants}
      getRowKey={(r) => r.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      empty={empty}
    />
  );
}
