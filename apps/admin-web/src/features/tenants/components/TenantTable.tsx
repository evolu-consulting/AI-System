// ADM-FR-60 · bảng Tenants: mã công ty (mono, link), tên, users, slot, trạng thái, menu `⋯` (Mở / Khoá / Mở khoá).
import type { Tenant } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useMemo } from "react";
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

type Props = {
  tenants: Tenant[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: React.ReactNode;
  onLock: (t: Tenant) => void;
  onUnlock: (t: Tenant) => void;
};

const isPlatform = (t: Tenant) => t.key === "platform";

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
  const columns = useMemo<Column<Tenant>[]>(
    () => [
      {
        id: "key",
        header: t("tenants.col.key"),
        cell: (r) => (
          <span className="inline-flex items-center gap-2">
            <Link
              to="/tenants/$tenantId"
              params={{ tenantId: r.id }}
              className="font-mono text-primary hover:underline"
            >
              {r.key}
            </Link>
            {isPlatform(r) ? (
              <StatusBadge tone="info">{t("tenants.badge.platform")}</StatusBadge>
            ) : null}
          </span>
        ),
      },
      { id: "name", header: t("tenants.col.name"), cell: (r) => r.name },
      { id: "users", header: t("tenants.col.users"), cell: (r) => r.user_count },
      {
        id: "slots",
        header: t("tenants.col.slots"),
        cell: (r) => r.max_concurrent_sub ?? t("common.unlimited"),
      },
      {
        id: "status",
        header: t("tenants.col.status"),
        cell: (r) =>
          r.status === "locked" ? (
            <StatusBadge tone="err">{t("tenants.status.locked")}</StatusBadge>
          ) : (
            <StatusBadge tone="ok">{t("tenants.status.active")}</StatusBadge>
          ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        className: "w-12 text-right",
        cell: (r) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/tenants/$tenantId" params={{ tenantId: r.id }}>
                  {t("tenants.menu.open")}
                </Link>
              </DropdownMenuItem>
              {isPlatform(r) ? null : r.status === "locked" ? (
                <DropdownMenuItem onSelect={() => onUnlock(r)}>
                  {t("tenants.menu.unlock")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => onLock(r)}>
                  {t("tenants.menu.lock")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
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
