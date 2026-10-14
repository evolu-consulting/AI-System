// ADM-FR-68 · PB-R21 · bảng Nguồn: Ký hiệu · Loại · Mô tả · Đích · Dùng bởi · Trạng thái + menu `⋯`.
// Cột Đích: `path` chỉ in cho platform_admin qua `localPathOf` (tenant_admin luôn thấy "Ẩn…"); không đưa path vào title/aria của dòng tenant.
import type { Role } from "@ai/contracts";
import type { SourceView } from "@ai/contracts/hub-admin";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  displayApplyMode,
  isPrivateSource,
  isViewOnly,
  localPathOf,
  pinLabel,
  shortGitTarget,
} from "../lib/source-view";

export type SourceAction = "edit" | "view" | "check" | "delete";

type Props = {
  sources: SourceView[] | undefined;
  role: Role | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onAction: (action: SourceAction, source: SourceView) => void;
};

function Target({ s, role }: { s: SourceView; role: Role | undefined }) {
  const { t } = useTranslation();
  const c = s.config;
  if (c.kind === "git_remote") {
    const text = shortGitTarget(c.url, c.branch);
    return (
      <span className="font-mono" title={`${c.url}@${c.branch}`}>
        {text}
      </span>
    );
  }
  if (c.kind === "library") return <span>{t("process.sources.target.library")}</span>;
  const path = localPathOf(c, role);
  if (path === null) {
    return <span className="text-muted-foreground">{t("process.sources.target.hidden")}</span>;
  }
  return (
    <span className="font-mono" title={path}>
      {path}
    </span>
  );
}

function ApplyModeCell({ config }: { config: SourceView["config"] }) {
  const { t } = useTranslation();
  const mode = displayApplyMode(config);
  if (mode === null) return <span className="text-muted-foreground">—</span>;
  const key = mode === "local" ? "local" : mode;
  return <span>{t(`process.sources.applyMode.${key}`)}</span>;
}

function Status({ s }: { s: SourceView }) {
  const { t } = useTranslation();
  const label = pinLabel(s.last_pin);
  if (!label) return <StatusBadge tone="off">{t("process.sources.status.unchecked")}</StatusBadge>;
  const pin = label.kind === "snapshot" ? t("process.sources.status.snapshot") : label.value;
  return <StatusBadge tone="ok">{t("process.sources.status.pinned", { pin })}</StatusBadge>;
}

function RowMenu({
  s,
  role,
  onAction,
}: {
  s: SourceView;
  role: Role | undefined;
  onAction: Props["onAction"];
}) {
  const { t } = useTranslation();
  const viewOnly = isViewOnly(s.kind, role);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("process.sources.row.actions", { key: s.key })}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {viewOnly ? (
          <DropdownMenuItem onSelect={() => onAction("view", s)}>
            {t("process.sources.row.view")}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => onAction("edit", s)}>
              {t("process.sources.row.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("check", s)}>
              {t("process.sources.row.check")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("delete", s)}>
              {t("process.sources.row.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SourceTable({
  sources,
  role,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onAction,
}: Props) {
  const { t } = useTranslation();
  const columns = useMemo<Column<SourceView>[]>(
    () => [
      {
        id: "key",
        header: t("process.sources.col.key"),
        cell: (s) => <span className="font-mono">{s.key}</span>,
      },
      {
        id: "kind",
        header: t("process.sources.col.kind"),
        cell: (s) => (
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant="info">{t(`process.sources.kind.${s.kind}`)}</Badge>
            {isPrivateSource(s.config) ? (
              <Badge variant="warn">{t("process.sources.badge.private")}</Badge>
            ) : null}
          </span>
        ),
      },
      {
        id: "applyMode",
        header: t("process.sources.col.applyMode"),
        cell: (s) => <ApplyModeCell config={s.config} />,
      },
      {
        id: "desc",
        header: t("process.sources.col.desc"),
        className: "max-w-64",
        cell: (s) => (
          <span className="block truncate text-muted-foreground" title={s.description}>
            {s.description}
          </span>
        ),
      },
      {
        id: "target",
        header: t("process.sources.col.target"),
        className: "max-w-72 truncate",
        cell: (s) => <Target s={s} role={role} />,
      },
      {
        id: "usedBy",
        header: t("process.sources.col.usedBy"),
        cell: (s) =>
          s.used_by.length === 0 ? (
            <span className="text-muted-foreground">{t("process.sources.usedBy.none")}</span>
          ) : (
            <span title={s.used_by.join(", ")}>
              {t("process.sources.usedBy.count", { count: s.used_by.length })}
            </span>
          ),
      },
      { id: "status", header: t("process.sources.col.status"), cell: (s) => <Status s={s} /> },
      {
        id: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        className: "w-12 text-right",
        cell: (s) => <RowMenu s={s} role={role} onAction={onAction} />,
      },
    ],
    [t, role, onAction],
  );
  return (
    <DataTable
      caption={t("process.sources.table")}
      columns={columns}
      rows={sources}
      getRowKey={(s) => s.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      empty={empty}
      skeletonRows={5}
    />
  );
}
