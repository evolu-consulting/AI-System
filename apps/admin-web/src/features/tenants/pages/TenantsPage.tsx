// ADM-FR-60, ADM-FR-61 · danh sách Tenants (mẫu A): chip trạng thái có số, ô tìm, bảng, khoá/mở khoá; chỉ platform_admin.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterChips } from "@/components/shared/FilterChips";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchBox } from "@/components/shared/SearchBox";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { useSession } from "@/lib/use-session";
import { useTenantList } from "../api";
import { TenantTable } from "../components/TenantTable";
import { useLockFlow } from "../hooks/use-lock-flow";

type StatusFilter = "all" | "active" | "locked";

export function TenantsPage() {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const allowed = role === "platform_admin";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const query = useTenantList({ q, status: status === "all" ? undefined : status }, allowed);
  const { requestLock, requestUnlock, dialogs } = useLockFlow();

  if (!allowed) return <ForbiddenState />;

  const counts = query.data?.counts;
  const err = query.error instanceof ApiError ? query.error : null;
  const filtered = q !== "" || status !== "all";
  const clear = () => {
    setQ("");
    setStatus("all");
  };
  const empty = filtered ? (
    <EmptyState
      message={q ? t("state.empty.noResults", { q }) : t("state.empty.noMatch")}
      action={
        <Button variant="outline" onClick={clear}>
          {t("common.clearFilters")}
        </Button>
      }
    />
  ) : (
    <EmptyState
      message={t("tenants.empty")}
      action={
        <Button asChild>
          <Link to="/tenants/new">{t("tenants.list.create")}</Link>
        </Button>
      }
    />
  );

  return (
    <>
      <PageHeader
        title={t("tenants.list.title")}
        description={t("tenants.list.subtitle")}
        actions={
          <Button asChild>
            <Link to="/tenants/new">{t("tenants.list.create")}</Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips<StatusFilter>
          label={t("tenants.col.status")}
          value={status}
          onChange={setStatus}
          chips={[
            { value: "all", label: t("common.all"), count: counts?.all },
            { value: "active", label: t("tenants.status.active"), count: counts?.active },
            { value: "locked", label: t("tenants.status.locked"), count: counts?.locked },
          ]}
        />
        <SearchBox label={t("common.search")} value={q} onChange={setQ} />
      </div>
      <TenantTable
        tenants={query.data?.items}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void query.refetch()}
        empty={empty}
        onLock={requestLock}
        onUnlock={requestUnlock}
      />
      {dialogs}
    </>
  );
}
