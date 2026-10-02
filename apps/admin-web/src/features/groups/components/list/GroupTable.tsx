// ADM-FR-62 · bảng Groups (mẫu A): `table "Groups"`, skeleton, rỗng, lỗi tải.
import type { GroupListItem } from "@ai/contracts";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { groupColumns } from "./group-columns";

type Props = {
  groups: GroupListItem[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onEdit: (g: GroupListItem) => void;
  onDelete: (g: GroupListItem) => void;
};

export function GroupTable({ groups, onEdit, onDelete, ...rest }: Props) {
  const { t, i18n } = useTranslation();
  const columns = useMemo(
    () => groupColumns({ t, lang: i18n.language, onEdit, onDelete }),
    [t, i18n.language, onEdit, onDelete],
  );
  return (
    <DataTable
      caption={t("groups.list.title")}
      columns={columns}
      rows={groups}
      getRowKey={(g) => g.id}
      {...rest}
    />
  );
}
