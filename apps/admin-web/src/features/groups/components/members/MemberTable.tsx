// ADM-FR-62 · M3-R03 · bảng thành viên (`table "Thành viên"`): skeleton, rỗng, lỗi tải.
import type { GroupMember } from "@ai/contracts";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { useTr } from "@/lib/use-translate";
import { memberColumns } from "./member-columns";

type Props = {
  members: GroupMember[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onRemove: (userId: string, username: string) => void;
};

export function MemberTable({ members, onRemove, ...rest }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const columns = useMemo(() => memberColumns({ t, tr, onRemove }), [t, tr, onRemove]);
  return (
    <DataTable
      caption={t("groups.tab.members")}
      columns={columns}
      rows={members}
      getRowKey={(m) => m.user_id}
      {...rest}
    />
  );
}
