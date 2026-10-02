// ADM-FR-62 · /groups (mẫu A): Tenant (platform), ô tìm, bảng phân trang server 50 dòng, `+ Tạo group`, sửa/xoá theo hàng.
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { GroupFilters } from "../components/list/GroupFilters";
import { GroupsEmpty } from "../components/list/GroupsEmpty";
import { GroupTable } from "../components/list/GroupTable";
import { useGroupDelete } from "../hooks/use-group-delete";
import { useGroupsNav } from "../hooks/use-groups-nav";
import { useGroupsView } from "../hooks/use-groups-view";
import { GROUPS_PAGE_SIZE } from "../lib/paging";

export function GroupsPage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const view = useGroupsView(me);
  const patch = useGroupsNav();
  const navigate = useNavigate();
  const { remove, dialog } = useGroupDelete();
  const { list, tenantKey, page } = view;

  if (!me) return null;
  if (view.unknown) return <NotFoundState backTo="/groups" />;

  const create = view.canCreate ? (
    <Button asChild>
      <Link
        to="/groups/new"
        search={{ tenant: view.isPlatform ? (tenantKey ?? undefined) : undefined }}
      >
        {t("groups.list.create")}
      </Link>
    </Button>
  ) : (
    <Button disabled>{t("groups.list.create")}</Button>
  );

  return (
    <>
      <PageHeader
        title={t("groups.list.title")}
        description={t("groups.list.subtitle", {
          tenant: tenantKey ?? t("common.tenantPicker.all"),
        })}
        actions={create}
      />
      <GroupFilters
        tenants={view.isPlatform ? (view.tenants ?? []) : undefined}
        tenantKey={tenantKey}
        q={view.search.q ?? ""}
        onTenant={(key) => patch({ tenant: key ?? undefined })}
        onQuery={(q) => patch({ q: q || undefined })}
      />
      <GroupTable
        groups={view.needsTenant ? [] : list.data?.items}
        isLoading={!view.needsTenant && list.isPending && view.ready}
        isFetching={list.isFetching}
        error={view.loadError}
        onRetry={() => void list.refetch()}
        empty={
          <GroupsEmpty
            needsTenant={view.needsTenant}
            filtered={view.filtered}
            q={view.search.q}
            createAction={view.canCreate ? create : undefined}
            onClear={() => patch({ q: undefined })}
          />
        }
        onEdit={(g) => void navigate({ to: "/groups/$groupId", params: { groupId: g.id } })}
        onDelete={remove}
      />
      <div className="mt-4">
        <Pagination
          offset={(page - 1) * GROUPS_PAGE_SIZE}
          limit={GROUPS_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={(o) => patch({ page: o / GROUPS_PAGE_SIZE + 1 }, true)}
        />
      </div>
      {dialog}
    </>
  );
}
