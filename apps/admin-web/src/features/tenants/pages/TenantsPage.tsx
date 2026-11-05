// ADM-FR-60, ADM-FR-61 · CR-121 C-3c · danh sách Công ty theo khuôn danh sách chung (ListPage): phễu lọc Trạng thái, chip có xoá,
// "n / tổng", bấm hàng mở ngăn tóm tắt (TenantDrawer); khoá/mở khoá ở menu hàng; chỉ platform_admin.
// CR-121 Q-1 · lọc theo Ứng dụng (server lọc `app`, mỗi hàng trả `apps`).
import { TENANT_APP_IDS, type TenantApp } from "@ai/contracts/tenants";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { ListEmpty, ListPage } from "@/components/shared/list/ListPage";
import type { FilterGroup } from "@/components/shared/list/list-filter";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useTenantList } from "../api";
import { TenantDrawer } from "../components/TenantDrawer";
import { TenantTable } from "../components/TenantTable";
import { useLockFlow } from "../hooks/use-lock-flow";

type Status = "active" | "locked";
const isApp = (v: string | undefined): v is TenantApp => TENANT_APP_IDS.some((a) => a === v);
const isStatus = (v: string | undefined): v is Status => v === "active" || v === "locked";

export function TenantsPage() {
  const { t } = useTranslation();
  const tr = useTr();
  const role = useSession((s) => s.me?.role);
  const allowed = role === "platform_admin";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | undefined>();
  const [app, setApp] = useState<TenantApp | undefined>();
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useTenantList({ q, status, app }, allowed);
  const { requestLock, requestUnlock, dialogs } = useLockFlow();

  if (!allowed) return <ForbiddenState />;

  const counts = query.data?.counts;
  const err = query.error instanceof ApiError ? query.error : null;
  const filtered = q !== "" || status !== undefined || app !== undefined;
  const opened = query.data?.items.find((x) => x.id === openId) ?? null;
  const clear = () => {
    setQ("");
    setStatus(undefined);
    setApp(undefined);
  };
  const create = (
    <Button asChild>
      <Link to="/tenants/new">{t("tenants.list.create")}</Link>
    </Button>
  );
  const groups: FilterGroup[] = [
    {
      id: "status",
      label: t("tenants.col.status"),
      value: status,
      options: [
        { value: "active", label: t("tenants.status.active"), count: counts?.active },
        { value: "locked", label: t("tenants.status.locked"), count: counts?.locked },
      ],
    },
    {
      id: "app",
      label: t("tenants.col.apps"),
      value: app,
      options: TENANT_APP_IDS.map((a) => ({ value: a, label: tr(`featmeta.app.${a}.name`) })),
    },
  ];
  const empty = filtered ? (
    <ListEmpty what={t("tenants.list.what")} onClear={clear} />
  ) : (
    <EmptyState message={t("tenants.empty")} action={create} />
  );

  return (
    <ListPage
      title={t("tenants.list.title")}
      description={t("tenants.list.subtitle")}
      count={counts?.all}
      primary={create}
      groups={groups}
      onChange={(id, v) =>
        id === "app" ? setApp(isApp(v) ? v : undefined) : setStatus(isStatus(v) ? v : undefined)
      }
      onClear={clear}
      search={<SearchBox label={t("common.search")} value={q} onChange={setQ} />}
      shown={query.data?.items.length}
      total={counts?.all}
    >
      <TenantTable
        tenants={query.data?.items}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void query.refetch()}
        empty={empty}
        onLock={requestLock}
        onUnlock={requestUnlock}
        onOpen={(row) => setOpenId(row.id)}
        activeId={openId}
      />
      <TenantDrawer tenant={opened} onClose={() => setOpenId(null)} />
      {dialogs}
    </ListPage>
  );
}
