// ADM-FR-51 · M4-R12 · Q8 · màn Nhật ký `/audit` (plan-frontend §3.4): lọc, timeline theo ngày, Tải thêm; chi tiết là Sheet ở route con.
import { getRouteApi, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { loadError } from "@/lib/load-error";
import { AuditFilters } from "../components/AuditFilters";
import { AuditTimeline } from "../components/AuditTimeline";
import { useAuditView } from "../hooks/use-audit-view";

const route = getRouteApi("/_authed/audit");

export function AuditPage() {
  const { t } = useTranslation();
  const v = useAuditView(route.useSearch());
  const { query } = v;
  const error = query.isError
    ? {
        ...(loadError(query.error) ?? { message: t("common.unavailable"), code: "HTTP_ERROR" }),
        onRetry: () => void query.refetch(),
      }
    : null;
  return (
    <>
      <PageHeader title={t("audit.title")} description={t("audit.subtitle")} />
      <div className="space-y-4">
        <AuditFilters
          search={v.search}
          period={v.period}
          platform={v.platform}
          tenants={v.tenants}
          filtered={v.filtered}
          onChange={v.set}
          onPeriod={v.setPeriod}
          onClear={v.clear}
        />
        <AuditTimeline
          items={v.items}
          search={v.search}
          loading={query.isPending && !query.isError}
          error={error}
          filtered={v.filtered}
          onClear={v.clear}
          hasMore={!!query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
        />
      </div>
      <Outlet />
    </>
  );
}
