// CR-118 · manifest dữ liệu theo app + luật xem trước thuần.
import { COMMUNITY_MANIFEST } from "./community.manifest";
import { CONTRACTS_MANIFEST } from "./contracts.manifest";
import type { AppManifest } from "./manifest";

export { COMMUNITY_MANIFEST } from "./community.manifest";
export { CONTRACTS_MANIFEST } from "./contracts.manifest";
export * from "./manifest";
export * from "./preview";
export * from "./slots.rules";

/** Manifest theo key app trong catalog (`admin.app_catalog.key`); app không có manifest ⇒ chưa có màn xem trước. */
export const APP_MANIFESTS: Readonly<Record<string, AppManifest>> = {
  contracts: CONTRACTS_MANIFEST,
  community: COMMUNITY_MANIFEST,
};

export const getAppManifest = (appKey: string): AppManifest | undefined => APP_MANIFESTS[appKey];
