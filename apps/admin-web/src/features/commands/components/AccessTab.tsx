// ADM-FR-24 · M2-R23 · tab "Ai dùng được" (chỉ phần tenant): bảng tenant dùng được command + card "Chưa khả dụng" cho nhóm/người dùng (M3).
import type { CommandAccessItem } from "@ai/contracts";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loadError } from "@/lib/load-error";
import { pickLocalized } from "@/lib/localized";
import { ACCESS_PAGE_SIZE, useCommandAccess } from "../hooks/use-command-queries";

export function AccessTab({ commandId }: { commandId: string }) {
  const { t, i18n } = useTranslation();
  const [offset, setOffset] = useState(0);
  const access = useCommandAccess(commandId, offset);
  const lang = i18n.language;
  const columns = useMemo<Column<CommandAccessItem>[]>(
    () => [
      {
        id: "key",
        header: t("commands.access.col.key"),
        cell: (a) => <span className="font-mono">{a.tenant_key}</span>,
      },
      {
        id: "name",
        header: t("commands.access.col.name"),
        cell: (a) => (
          <span className="flex items-center gap-2">
            {a.tenant_name}{" "}
            {a.tenant_active ? null : (
              <StatusBadge tone="err">{t("commands.access.tenantLocked")}</StatusBadge>
            )}
          </span>
        ),
      },
      {
        id: "features",
        header: t("commands.access.col.features"),
        cell: (a) => (
          <span className="flex flex-wrap gap-1">
            {a.features.map((f) => (
              <StatusBadge key={f.id} tone="info">
                {pickLocalized(f.name, lang)}
              </StatusBadge>
            ))}
          </span>
        ),
      },
      { id: "users", header: t("commands.access.col.users"), cell: (a) => a.active_user_count },
    ],
    [t, lang],
  );
  const err = loadError(access.error);

  return (
    <div className="space-y-4">
      {access.data && !access.data.command_active ? (
        <Alert>
          <AlertDescription>{t("commands.access.inactive")}</AlertDescription>
        </Alert>
      ) : null}
      <DataTable
        caption={t("commands.tab.access")}
        columns={columns}
        rows={access.data?.items}
        getRowKey={(a) => a.tenant_id}
        isLoading={access.isPending}
        isFetching={access.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void access.refetch()}
        empty={<EmptyState message={t("commands.access.empty")} />}
      />
      <Pagination
        offset={offset}
        limit={ACCESS_PAGE_SIZE}
        total={access.data?.total ?? 0}
        onOffsetChange={setOffset}
      />
      <div className="rounded-lg border border-dashed border-border bg-card p-4 text-body text-muted-foreground">
        {t("commands.access.groupsLater")}
      </div>
    </div>
  );
}
