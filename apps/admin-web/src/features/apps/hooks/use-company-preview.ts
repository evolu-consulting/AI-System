// CR-118 · cr118-app-config · xem trước "công ty này sẽ thấy gì": nạp feature đã lưu + vai + quy trình đang gán của MỘT công ty rồi gọi luật thuần
// `previewApp` (@ai/contracts, cùng luật với shell web gộp). Bản nháp = tập key feature chưa lưu do thẻ app đang giữ.
import { type AppManifest, type PreviewSlotAssign, previewApp } from "@ai/contracts/app-manifest";
import { useMemo } from "react";
import { useTenantSlots } from "@/features/processes/library-api";
import { useTenantFeatureStates } from "@/features/tenants/api";
import { useTenantAppRoles } from "@/features/tenants/api-apps";
import { entitledKeys } from "@/features/tenants/lib/feature-assign";
import type { PreviewVersion } from "../lib/app-config";

export function useCompanyPreview(
  tenantId: string | undefined,
  manifest: AppManifest | undefined,
  version: PreviewVersion,
  draft: ReadonlySet<string> | null,
) {
  const on = !!tenantId && !!manifest;
  const featuresQ = useTenantFeatureStates(tenantId ?? "", on);
  const rolesQ = useTenantAppRoles(tenantId ?? "", on);
  const slotsQ = useTenantSlots(tenantId ?? "", on);
  const saved = useMemo(() => entitledKeys(featuresQ.data ?? []), [featuresQ.data]);
  const keys = version === "draft" && draft ? draft : saved;
  const result = useMemo(() => {
    if (!manifest || !featuresQ.data) return null;
    const roles = (rolesQ.data?.items ?? []).map((r) => ({ pack: r.pack, level: r.level }));
    const slots: PreviewSlotAssign[] = (slotsQ.data ?? []).map((s) => ({
      slot: s.slot,
      def_name: s.def_name,
      rel_version: s.rel_version,
      is_default: s.is_default,
    }));
    return previewApp(manifest, keys, roles, slots);
  }, [manifest, featuresQ.data, rolesQ.data, slotsQ.data, keys]);
  return {
    result,
    pending: on && (featuresQ.isPending || rolesQ.isPending),
    error: featuresQ.error ?? rolesQ.error ?? null,
    refetch: () => {
      void featuresQ.refetch();
      void rolesQ.refetch();
    },
  };
}
