// ADM-FR-75 · drawer tài khoản của một công ty đối tác (`?org=`): danh sách, `+ Thêm tài khoản` (ẩn khi công ty đã vô hiệu), menu từng tài khoản.
import type { User } from "@ai/contracts";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/shared/DataTable";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { Pagination } from "@/components/shared/Pagination";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { PARTNERS_PAGE_SIZE, useOrg, useOrgUsers } from "../api";
import { usePartnerUserActions } from "../hooks/use-partner-user-actions";
import { partnerUserColumns } from "./partner-user-columns";

type Props = { orgId: string; tenantKey: string; onClose: () => void };

function UsersTable({
  orgId,
  orgActive,
  tenantKey,
}: {
  orgId: string;
  orgActive: boolean;
  tenantKey: string;
}) {
  const { t } = useTranslation();
  const tr = useTr();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const list = useOrgUsers(orgId, q, offset);
  const actions = usePartnerUserActions(orgId, tenantKey);
  const columns = useMemo(
    () => partnerUserColumns({ t, tr, orgActive, onAction: actions.onAction }),
    [t, tr, orgActive, actions.onAction],
  );
  const err = list.error instanceof ApiError ? list.error : null;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchBox
          label={t("partners.drawer.search")}
          value={q}
          onChange={(v) => {
            setQ(v);
            setOffset(0);
          }}
        />
        {orgActive ? (
          <Button className="ml-auto" onClick={actions.openCreate}>
            {t("partners.user.add")}
          </Button>
        ) : null}
      </div>
      <DataTable
        caption={t("partners.user.tableLabel")}
        columns={columns}
        rows={list.data?.items}
        getRowKey={(u: User) => u.id}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={<EmptyState message={t("partners.drawer.empty")} />}
      />
      <div className="mt-4">
        <Pagination
          offset={offset}
          limit={PARTNERS_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={setOffset}
        />
      </div>
      {actions.dialogs}
    </>
  );
}

export function PartnerDrawer({ orgId, tenantKey, onClose }: Props) {
  const { t } = useTranslation();
  const org = useOrg(orgId);
  const title = org.data
    ? t("partners.drawer.title", { name: org.data.name })
    : t("partners.title");
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-[820px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {title}
            {org.data && !org.data.active ? (
              <StatusBadge tone="off">{t("partners.status.inactive")}</StatusBadge>
            ) : null}
          </SheetTitle>
          <SheetDescription className="sr-only">{title}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {org.isError ? (
            <p className="text-body text-muted-foreground">{t("state.notFound.body")}</p>
          ) : org.data ? (
            <UsersTable orgId={orgId} orgActive={org.data.active} tenantKey={tenantKey} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
