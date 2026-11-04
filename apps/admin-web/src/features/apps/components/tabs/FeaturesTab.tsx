// CR-118 · cr118-app-config · tab "Tính năng" của app: đúng nhóm của app trong danh mục Feature (FeatureTable/FeatureGroupSection dùng lại,
// tên dễ hiểu + mô tả, key mờ, "đang bật ở n công ty" mở tab Tenant của feature) + tóm tắt vai theo app (vai là dữ liệu của từng công ty).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { FeatureTable } from "@/features/features/components/FeatureTable";
import { useFeatureActions } from "@/features/features/hooks/use-feature-actions";
import { useFeatureList } from "@/features/features/hooks/use-feature-queries";
import { type AppId, metaOf } from "@/features/features/lib/feature-meta";
import { loadError } from "@/lib/load-error";

export function FeaturesTab({ appId }: { appId: AppId | null }) {
  const { t } = useTranslation();
  const list = useFeatureList({ q: "", offset: 0 }, appId !== null);
  const actions = useFeatureActions();
  if (!appId) return <EmptyState message={t("appcfg.features.noGroup")} />;
  const items = (list.data?.items ?? []).filter((f) => metaOf(f.key).app === appId);
  const err = loadError(list.error);
  return (
    <div className="space-y-4">
      <FeatureTable
        features={list.data ? items : undefined}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={<EmptyState message={t("appcfg.features.empty")} />}
        onStatus={actions.setStatus}
        onDelete={actions.remove}
      />
      <section
        aria-label={t("appcfg.features.rolesTitle")}
        className="rounded-xl border border-border bg-card p-4"
      >
        <h3 className="text-label font-semibold">{t("appcfg.features.rolesTitle")}</h3>
        <p className="mt-1 text-caption text-muted-foreground">{t("appcfg.features.rolesDesc")}</p>
      </section>
      <p className="text-caption text-muted-foreground">
        {t("appcfg.features.catalogHint")}{" "}
        <Link to="/features" className="underline">
          {t("appcfg.features.catalogLink")}
        </Link>
      </p>
      {actions.dialogs}
    </div>
  );
}
