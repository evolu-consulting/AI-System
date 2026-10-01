// ADM-FR-04, ADM-FR-05, ADM-FR-63 · /users (canvas Users): bộ lọc trên URL, bảng phân trang server 50 dòng, drawer tạo/sửa, hành động hàng.
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { useSession } from "@/lib/use-session";
import { USERS_PAGE_SIZE } from "../api";
import { CreateUserButton } from "../components/CreateUserButton";
import { type RoleFilter, type StatusFilter, UserFilters } from "../components/UserFilters";
import { UsersEmpty } from "../components/UsersEmpty";
import { UserTable } from "../components/UserTable";
import { useUserActions } from "../hooks/use-user-actions";
import { useUsersNav } from "../hooks/use-users-nav";
import { useUsersView } from "../hooks/use-users-view";
import { UserDrawerController } from "./UserDrawerController";

export function UsersPage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const view = useUsersView(me);
  const { list, tenantKey, page, filterState } = view;
  const nav = useUsersNav();
  const { onAction, dialogs } = useUserActions();

  if (!me) return null;
  if (view.unknown) return <NotFoundState backTo="/users" />;

  const createButton = <CreateUserButton canCreate={view.canCreate} onCreate={nav.openCreate} />;
  const clearFilters = () =>
    nav.patch({ q: undefined, status: undefined, role: undefined, login: undefined });

  return (
    <>
      <PageHeader
        title={t("users.list.title")}
        description={t("users.list.subtitle", {
          tenant: tenantKey ?? t("common.tenantPicker.all"),
        })}
        actions={createButton}
      />
      <UserFilters
        {...filterState}
        tenants={view.isPlatform ? (view.tenants ?? []) : undefined}
        tenantKey={tenantKey}
        counts={list.data?.counts}
        showPlatformRole={tenantKey === "platform"}
        onTenant={(key) => nav.patch({ tenant: key ?? undefined })}
        onStatus={(s: StatusFilter) => nav.patch({ status: s === "all" ? undefined : s })}
        onRole={(r: RoleFilter) => nav.patch({ role: r === "all" ? undefined : r })}
        onNever={(never) => nav.patch({ login: never ? "never" : undefined })}
        onQuery={(q) => nav.patch({ q: q || undefined })}
      />
      <UserTable
        users={list.data?.items}
        selfId={me.id}
        showTenant={view.isPlatform && !tenantKey}
        isLoading={list.isPending && view.ready}
        isFetching={list.isFetching}
        error={view.loadError}
        onRetry={() => void list.refetch()}
        empty={
          <UsersEmpty
            filtered={view.filtered}
            q={view.search.q}
            createAction={view.canCreate ? createButton : undefined}
            onClear={clearFilters}
          />
        }
        onEdit={nav.onEdit}
        onAction={onAction}
      />
      <div className="mt-4">
        <Pagination
          offset={(page - 1) * USERS_PAGE_SIZE}
          limit={USERS_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={(o) => nav.patch({ page: o / USERS_PAGE_SIZE + 1 }, true)}
        />
      </div>
      {view.drawerOpen ? (
        <UserDrawerController
          mode={view.drawerMode}
          userId={view.search.user}
          tenantKey={tenantKey ?? ""}
          tenantId={view.tenantId}
          selfId={me.id}
          onClose={nav.closeDrawer}
        />
      ) : null}
      {dialogs}
    </>
  );
}
