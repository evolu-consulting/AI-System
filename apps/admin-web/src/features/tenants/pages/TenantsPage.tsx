// ADM-FR-60, ADM-FR-61 · CR-121 C-3c · danh sách Công ty theo khuôn danh sách chung (ListPage): phễu lọc Trạng thái, chip có xoá,
// "n / tổng", bấm hàng mở ngăn tóm tắt (TenantDrawer); khoá/mở khoá ở menu hàng; chỉ platform_admin.
// Lọc theo ứng dụng chưa có: API danh sách chưa trả ứng dụng đang bật (xem docs/specs/cr121-c3c-tenants-list/tasks.md).
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
import { useTenantList } from "../api";
import { TenantDrawer } from "../components/TenantDrawer";
import { TenantTable } from "../components/TenantTable";
import { useLockFlow } from "../hooks/use-lock-flow";

type Status = "active" | "locked";
const isStatus = (v: string | undefined): v is Status => v === "active" || v === "locked";

export function TenantsPage() {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const allowed = role === "platform_admin";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | undefined>();
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useTenantList({ q, status }, allowed);
  const { requestLock, requestUnlock, dialogs } = useLockFlow();

  if (!allowed) return <ForbiddenState />;

  const counts = query.data?.counts;
  const err = query.error instanceof ApiError ? query.error : null;
  const filtered = q !== "" || status !== undefined;
  const opened = query.data?.items.find((x) => x.id === openId) ?? null;
  const clear = () => {
    setQ("");
    setStatus(undefined);
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
      onChange={(_id, v) => setStatus(isStatus(v) ? v : undefined)}
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
