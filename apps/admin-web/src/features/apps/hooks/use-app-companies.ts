// CR-118 · cr118-app-config · dữ liệu "công ty nào đang dùng app này": feature của app (từ danh mục) + entitlement từng feature + danh sách công ty.
// Không có endpoint gộp (làn đầy đủ, để lát sau nếu cần): dùng API sẵn có, số lời gọi = số feature của app (≤ 8), không phụ thuộc số công ty.
import { useMemo } from "react";
import { useFeatureList, useTenantOptions } from "@/features/features/api";
import { type AppId, metaOf } from "@/features/features/lib/feature-meta";
import { useFeatureEntitlementLists } from "../api";
import { buildCompanyRows, type EntRow } from "../lib/app-config";

export function useAppCompanies(appId: AppId | null) {
  const features = useFeatureList({ q: "", offset: 0 }, appId !== null);
  const tenants = useTenantOptions(appId !== null);
  const appFeatures = useMemo(
    () => (features.data?.items ?? []).filter((f) => appId && metaOf(f.key).app === appId),
    [features.data, appId],
  );
  const lists = useFeatureEntitlementLists(appFeatures.map((f) => f.id));
  const pending = features.isPending || tenants.isPending || lists.some((q) => q.isPending);
  const error = features.error ?? tenants.error ?? lists.find((q) => q.error)?.error ?? null;
  const rows = useMemo(() => {
    if (!appId || !tenants.data) return [];
    const ents: Record<string, EntRow[]> = {};
    appFeatures.forEach((f, i) => {
      ents[f.key] = lists[i]?.data?.items ?? [];
    });
    return buildCompanyRows(tenants.data, ents, appId);
  }, [appId, tenants.data, appFeatures, lists]);
  return {
    rows,
    pending,
    error,
    appFeatures,
    refetch: () => {
      void features.refetch();
      void tenants.refetch();
      for (const q of lists) void q.refetch();
    },
  };
}
