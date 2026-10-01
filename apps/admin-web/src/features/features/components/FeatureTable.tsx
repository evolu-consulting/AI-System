// ADM-FR-30 · bảng Features: icon + tên + key (mono), trạng thái, số command, số tenant ("Mọi tenant" cho core), cập nhật, menu `⋯`.
import type { FeatureListItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { formatUpdated } from "@/lib/format";
import { pickLocalized } from "@/lib/localized";
import type { FeatureStatusFilter } from "../hooks/use-feature-queries";
import { FeatureIcon } from "./FeatureIcon";
import { FeatureRowMenu } from "./FeatureRowMenu";

const TONE: Record<FeatureStatusFilter, StatusTone> = { on: "ok", beta: "info", off: "off" };

type Props = {
  features: FeatureListItem[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onStatus: (f: FeatureListItem, status: FeatureStatusFilter) => void;
  onDelete: (f: FeatureListItem) => void;
};

export function FeatureTable({
  features,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onStatus,
  onDelete,
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const columns = useMemo<Column<FeatureListItem>[]>(
    () => [
      {
        id: "name",
        header: t("features.col.name"),
        cell: (f) => (
          <div className="flex items-center gap-2">
            <FeatureIcon name={f.icon} className="text-muted-foreground" />
            <div className="min-w-0">
              <Link
                to="/features/$featureId"
                params={{ featureId: f.id }}
                className="font-medium text-foreground hover:underline"
              >
                {pickLocalized(f.name, lang)}
              </Link>{" "}
              <p className="font-mono text-caption text-muted-foreground">{f.key}</p>{" "}
              {f.is_core ? <StatusBadge tone="info">{t("features.default")}</StatusBadge> : null}
            </div>
          </div>
        ),
      },
      {
        id: "status",
        header: t("features.col.status"),
        cell: (f) => (
          <StatusBadge tone={TONE[f.status]}>{t(`features.status.${f.status}`)}</StatusBadge>
        ),
      },
      { id: "commands", header: t("features.col.commands"), cell: (f) => f.command_count },
      {
        id: "tenants",
        header: t("features.col.tenants"),
        cell: (f) => (f.is_core ? t("features.allTenants") : f.tenant_count),
      },
      {
        id: "updated",
        header: t("features.col.updated"),
        cell: (f) => formatUpdated(f.updated_at, f.updated_by),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        className: "w-12 text-right",
        cell: (f) => <FeatureRowMenu feature={f} onStatus={onStatus} onDelete={onDelete} />,
      },
    ],
    [t, lang, onStatus, onDelete],
  );
  return (
    <DataTable
      caption={t("features.list.title")}
      columns={columns}
      rows={features}
      getRowKey={(f) => f.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      empty={empty}
    />
  );
}
