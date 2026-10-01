// ADM-FR-30, ADM-FR-31 · cổng hook cho component của Features: component chỉ gọi hook ở đây, không import `api.ts` (luật component-no-fetch).
export {
  ENTITLEMENTS_PAGE_SIZE,
  type FeatureStatusFilter,
  useCommandOptions,
  useEntitlements,
  useGrantedTenantIds,
  useTenantOptions,
} from "../api";
