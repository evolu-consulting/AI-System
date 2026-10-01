// ADM-FR-50 · bảng Secrets: tên (mono), `•••• last4`, ghi chú, đang được dùng bởi, cập nhật, menu `⋯`. Không có hành động xem/copy giá trị.
import type { Secret } from "@ai/contracts";
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
import { formatUpdated } from "@/lib/format";

export type SecretAction = "replace" | "note" | "delete";

type Props = {
  secrets: Secret[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onAction: (action: SecretAction, secret: Secret) => void;
};

function UsedBy({ keys }: { keys: string[] }) {
  const { t } = useTranslation();
  if (keys.length === 0) return <StatusBadge tone="off">{t("secrets.col.unused")}</StatusBadge>;
  return (
    <span className="flex flex-wrap gap-x-2">
      {keys.map((key) => (
        <Link
          key={key}
          to="/workflows"
          search={{ q: key }}
          className="font-mono text-primary underline-offset-4 hover:underline"
        >
          {key}
        </Link>
      ))}
    </span>
  );
}

function RowMenu({ secret, onAction }: { secret: Secret; onAction: Props["onAction"] }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onAction("replace", secret)}>
          {t("secrets.menu.replace")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("note", secret)}>
          {t("secrets.menu.editNote")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("delete", secret)}>
          {t("secrets.menu.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SecretTable({
  secrets,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onAction,
}: Props) {
  const { t } = useTranslation();
  const columns = useMemo<Column<Secret>[]>(
    () => [
      {
        id: "name",
        header: t("secrets.col.name"),
        cell: (s) => <span className="font-mono">{s.name}</span>,
      },
      {
        id: "value",
        header: t("secrets.col.value"),
        cell: (s) => <span className="font-mono">{`•••• ${s.last4}`}</span>,
      },
      {
        id: "note",
        header: t("secrets.col.note"),
        cell: (s) => <span className="text-muted-foreground">{s.note ?? ""}</span>,
      },
      {
        id: "usedBy",
        header: t("secrets.col.usedBy"),
        cell: (s) => <UsedBy keys={s.used_by} />,
      },
      {
        id: "updated",
        header: t("secrets.col.updated"),
        cell: (s) => formatUpdated(s.updated_at, s.updated_by),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        className: "w-12 text-right",
        cell: (s) => <RowMenu secret={s} onAction={onAction} />,
      },
    ],
    [t, onAction],
  );
  return (
    <DataTable
      caption={t("secrets.list.title")}
      columns={columns}
      rows={secrets}
      getRowKey={(s) => s.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      empty={empty}
    />
  );
}
