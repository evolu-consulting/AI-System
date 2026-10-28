// ADM-FR-74 · bảng công ty đối tác (`table "Đối tác"`): skeleton, rỗng, lỗi tải.
import type { ExternalOrg } from "@ai/contracts";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { partnerColumns } from "./partner-columns";

type Props = {
  orgs: ExternalOrg[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onOpen: (o: ExternalOrg) => void;
  onRename: (o: ExternalOrg) => void;
  onDeactivate: (o: ExternalOrg) => void;
  onReactivate: (o: ExternalOrg) => void;
};

export function PartnerTable({
  orgs,
  onOpen,
  onRename,
  onDeactivate,
  onReactivate,
  ...rest
}: Props) {
  const { t } = useTranslation();
  const columns = useMemo(
    () => partnerColumns({ t, onOpen, onRename, onDeactivate, onReactivate }),
    [t, onOpen, onRename, onDeactivate, onReactivate],
  );
  return (
    <DataTable
      caption={t("partners.title")}
      columns={columns}
      rows={orgs}
      getRowKey={(o) => o.id}
      {...rest}
    />
  );
}
