// ADM-FR-50 · /secrets (canvas Secrets): chip có số, ô tìm, bảng phân trang server 50 dòng, drawer Thêm/Thay giá trị/Sửa ghi chú, xoá.
import type { Secret } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FilterChips } from "@/components/shared/form/FilterChips";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { SECRETS_PAGE_SIZE, useSecretList } from "../api";
import { SecretsEmpty } from "../components/SecretsEmpty";
import { type SecretAction, SecretTable } from "../components/SecretTable";
import { useSecretDelete } from "../hooks/use-secret-delete";
import { useSecretsNav } from "../hooks/use-secrets-nav";
import { SecretDrawerController } from "./SecretDrawerController";

const route = getRouteApi("/_authed/secrets");
type UsedFilter = "all" | "true" | "false";

const usedChip = (u: boolean | undefined): UsedFilter =>
  u === undefined ? "all" : u ? "true" : "false";

function SecretsContent() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const nav = useSecretsNav();
  const del = useSecretDelete();
  const page = search.page ?? 1;
  const used = search.used;
  const list = useSecretList(
    { q: search.q ?? "", used, offset: (page - 1) * SECRETS_PAGE_SIZE },
    true,
  );
  const err = list.error instanceof ApiError ? list.error : null;
  const filtered = !!search.q || search.used !== undefined;
  const counts = list.data?.counts;

  const onAction = useCallback(
    (action: SecretAction, s: Secret) => {
      if (action === "delete") del.request(s);
      else nav.openDrawer(action, s.name);
    },
    [del.request, nav.openDrawer],
  );
  const create = <Button onClick={() => nav.openDrawer("new")}>{t("secrets.list.create")}</Button>;
  const clear = () => nav.patch({ q: undefined, used: undefined });

  return (
    <>
      <PageHeader
        title={t("secrets.list.title")}
        description={t("secrets.list.subtitle")}
        actions={create}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterChips<UsedFilter>
          label={t("secrets.col.usedBy")}
          value={usedChip(search.used)}
          onChange={(v) => nav.patch({ used: v === "all" ? undefined : v === "true" })}
          chips={[
            { value: "all", label: t("common.all"), count: counts?.all },
            { value: "true", label: t("secrets.filter.used"), count: counts?.used },
            { value: "false", label: t("secrets.filter.unused"), count: counts?.unused },
          ]}
        />
        <div className="ml-auto w-full sm:w-auto">
          <SearchBox
            label={t("common.search")}
            value={search.q ?? ""}
            onChange={(q) => nav.patch({ q: q || undefined })}
          />
        </div>
      </div>
      <SecretTable
        secrets={list.data?.items}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={
          <SecretsEmpty filtered={filtered} q={search.q} createAction={create} onClear={clear} />
        }
        onAction={onAction}
      />
      <div className="mt-4">
        <Pagination
          offset={(page - 1) * SECRETS_PAGE_SIZE}
          limit={SECRETS_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={(o) => nav.patch({ page: o / SECRETS_PAGE_SIZE + 1 }, true)}
        />
      </div>
      {search.drawer ? (
        <SecretDrawerController
          key={`${search.drawer}-${search.secret ?? ""}`}
          mode={search.drawer === "new" ? "create" : search.drawer}
          name={search.secret}
          onClose={nav.closeDrawer}
        />
      ) : null}
      {del.dialogs}
    </>
  );
}

/** Chỉ `platform_admin`: vai khác thấy ForbiddenState và không gọi API (hooks nằm trong `SecretsContent`). */
export function SecretsPage() {
  return (
    <PlatformOnly>
      <SecretsContent />
    </PlatformOnly>
  );
}
