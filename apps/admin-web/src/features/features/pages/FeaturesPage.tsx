// ADM-FR-30 · /features (mẫu A): chip trạng thái có số, ô tìm, bảng phân trang server 50 dòng, đổi trạng thái/xoá ở menu hàng.
import { getRouteApi, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FilterChips } from "@/components/shared/form/FilterChips";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { FEATURES_PAGE_SIZE, type FeatureStatusFilter, useFeatureList } from "../api";
import { FeatureTable } from "../components/FeatureTable";
import { useFeatureActions } from "../hooks/use-feature-actions";
import { useFeaturesNav } from "../hooks/use-features-nav";

const route = getRouteApi("/_authed/features/");
type Status = "all" | FeatureStatusFilter;

function FeaturesContent() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const patch = useFeaturesNav();
  const actions = useFeatureActions();
  const page = search.page ?? 1;
  const list = useFeatureList(
    { q: search.q ?? "", status: search.status, offset: (page - 1) * FEATURES_PAGE_SIZE },
    true,
  );
  const err = list.error instanceof ApiError ? list.error : null;
  const filtered = !!search.q || !!search.status;
  const counts = list.data?.counts;
  const create = (
    <Button asChild>
      <Link to="/features/new">{t("features.list.create")}</Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("features.list.title")}
        description={t("features.list.subtitle")}
        actions={create}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterChips<Status>
          label={t("features.col.status")}
          value={search.status ?? "all"}
          onChange={(s) => patch({ status: s === "all" ? undefined : s })}
          chips={[
            { value: "all", label: t("common.all"), count: counts?.all },
            { value: "on", label: t("features.status.on"), count: counts?.on },
            { value: "beta", label: t("features.status.beta"), count: counts?.beta },
            { value: "off", label: t("features.status.off"), count: counts?.off },
          ]}
        />
        <div className="ml-auto w-full sm:w-auto">
          <SearchBox
            label={t("common.search")}
            value={search.q ?? ""}
            onChange={(q) => patch({ q: q || undefined })}
          />
        </div>
      </div>
      <FeatureTable
        features={list.data?.items}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={
          filtered ? (
            <EmptyState
              message={
                search.q ? t("state.empty.noResults", { q: search.q }) : t("state.empty.noMatch")
              }
              action={
                <Button
                  variant="outline"
                  onClick={() => patch({ q: undefined, status: undefined })}
                >
                  {t("common.clearFilters")}
                </Button>
              }
            />
          ) : (
            <EmptyState message={t("features.empty")} action={create} />
          )
        }
        onStatus={actions.setStatus}
        onDelete={actions.remove}
      />
      <div className="mt-4">
        <Pagination
          offset={(page - 1) * FEATURES_PAGE_SIZE}
          limit={FEATURES_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={(o) => patch({ page: o / FEATURES_PAGE_SIZE + 1 }, true)}
        />
      </div>
      {actions.dialogs}
    </>
  );
}

/** Chỉ `platform_admin`: vai khác thấy ForbiddenState và không gọi API (hooks nằm trong `FeaturesContent`). */
export function FeaturesPage() {
  return (
    <PlatformOnly>
      <FeaturesContent />
    </PlatformOnly>
  );
}
