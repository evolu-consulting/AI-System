// ADM-FR-30 · /features (mẫu A): chip trạng thái có số, ô tìm, bảng phân trang server 50 dòng, đổi trạng thái/xoá ở menu hàng.
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { ListEmpty, ListPage } from "@/components/shared/list/ListPage";
import type { FilterGroup } from "@/components/shared/list/list-filter";
import { Pagination } from "@/components/shared/Pagination";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { FEATURES_PAGE_SIZE, type FeatureStatusFilter, useFeatureList } from "../api";
import { FeatureDrawer } from "../components/FeatureDrawer";
import { FeatureTable } from "../components/FeatureTable";
import { useFeatureActions } from "../hooks/use-feature-actions";
import { useFeaturesNav } from "../hooks/use-features-nav";

const route = getRouteApi("/_authed/features/");

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
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = list.data?.items.find((f) => f.id === openId) ?? null;
  const clear = () => patch({ q: undefined, status: undefined });
  const create = (
    <Button asChild>
      <Link to="/features/new">{t("features.list.create")}</Link>
    </Button>
  );
  const groups: FilterGroup[] = [
    {
      id: "status",
      label: t("features.col.status"),
      value: search.status,
      options: [
        { value: "on", label: t("features.status.on"), count: counts?.on },
        { value: "beta", label: t("features.status.beta"), count: counts?.beta },
        { value: "off", label: t("features.status.off"), count: counts?.off },
      ],
    },
  ];

  return (
    <ListPage
      title={t("features.list.title")}
      description={t("features.list.subtitle")}
      count={counts?.all}
      primary={create}
      groups={groups}
      onChange={(_id, v) => patch({ status: v as FeatureStatusFilter | undefined })}
      onClear={clear}
      search={
        <SearchBox
          label={t("common.search")}
          value={search.q ?? ""}
          onChange={(q) => patch({ q: q || undefined })}
        />
      }
      shown={list.data?.total}
      total={counts?.all}
    >
      <FeatureTable
        onOpen={(f) => setOpenId(f.id)}
        activeId={openId}
        features={list.data?.items}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={
          filtered ? (
            <ListEmpty what={t("features.list.what")} onClear={clear} />
          ) : (
            <EmptyState message={t("features.empty")} action={create} />
          )
        }
        onStatus={actions.setStatus}
        onDelete={actions.remove}
      />
      <div>
        <Pagination
          offset={(page - 1) * FEATURES_PAGE_SIZE}
          limit={FEATURES_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={(o) => patch({ page: o / FEATURES_PAGE_SIZE + 1 }, true)}
        />
      </div>
      <FeatureDrawer feature={opened} onClose={() => setOpenId(null)} />
      {actions.dialogs}
    </ListPage>
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
