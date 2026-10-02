// ADM-FR-04 · bảng Users (`table "Users"`): skeleton, rỗng, lỗi tải; cột ở user-columns.tsx.
import type { User } from "@ai/contracts";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { useTr } from "@/lib/use-translate";
import type { UserActionKind } from "../../lib/status";
import { userColumns } from "./user-columns";

type Props = {
  users: User[] | undefined;
  selfId: string;
  showTenant: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onEdit: (u: User) => void;
  onAction: (kind: UserActionKind, u: User) => void;
};

export function UserTable({
  users,
  selfId,
  showTenant,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onEdit,
  onAction,
}: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const columns = useMemo(
    () => userColumns({ t, tr, selfId, showTenant, onEdit, onAction }),
    [t, tr, selfId, showTenant, onEdit, onAction],
  );

  return (
    <DataTable
      caption={t("users.list.title")}
      columns={columns}
      rows={users}
      getRowKey={(u) => u.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      empty={empty}
    />
  );
}
