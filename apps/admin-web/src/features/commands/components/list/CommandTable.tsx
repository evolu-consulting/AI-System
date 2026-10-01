// ADM-FR-20 · bảng Commands (cột dựng ở lib/command-columns).
import type { CommandListItem } from "@ai/contracts";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { useTr } from "@/lib/use-translate";
import { buildCommandColumns } from "../../lib/command-columns";

type Props = {
  commands: CommandListItem[] | undefined;
  optimistic: Record<string, boolean>;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onToggle: (c: CommandListItem, enabled: boolean) => void;
  onDelete: (c: CommandListItem) => void;
};

export function CommandTable({ commands, optimistic, onToggle, onDelete, ...table }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const lang = i18n.language;
  const columns = useMemo(
    () => buildCommandColumns({ t: tr, lang, optimistic, onToggle, onDelete }),
    [tr, lang, optimistic, onToggle, onDelete],
  );
  return (
    <DataTable
      caption={t("commands.list.title")}
      columns={columns}
      rows={commands}
      getRowKey={(c) => c.id}
      {...table}
    />
  );
}
