// CR-118 · manifest dữ liệu theo app + luật xem trước thuần.
import { COMMUNITY_MANIFEST } from "./community.manifest";
import { CONTRACTS_MANIFEST } from "./contracts.manifest";
import type { AppEventDecl, AppManifest, AppNodeIo } from "./manifest";
import { startOutputsOf } from "./start-outputs";

export { COMMUNITY_MANIFEST } from "./community.manifest";
export { CONTRACTS_MANIFEST } from "./contracts.manifest";
export * from "./core.nodes";
export * from "./events.rules";
export * from "./manifest";
export * from "./nodes.rules";
export * from "./preview";
export * from "./slots.rules";
export * from "./start-outputs";

/** Manifest theo key app trong catalog (`admin.app_catalog.key`); app không có manifest ⇒ chưa có màn xem trước. */
export const APP_MANIFESTS: Readonly<Record<string, AppManifest>> = {
  contracts: CONTRACTS_MANIFEST,
  community: COMMUNITY_MANIFEST,
};

export const getAppManifest = (appKey: string): AppManifest | undefined => APP_MANIFESTS[appKey];

/** CR-122 · A · sự kiện `event` của app `app`; không có ⇒ undefined. */
export function eventOf(
  app: string | null | undefined,
  event: string | null | undefined,
): AppEventDecl | undefined {
  if (!app || !event) return undefined;
  return APP_MANIFESTS[app]?.events.find((e) => e.key === event);
}

/** CR-122 · A · đầu ra Bắt đầu khi của một def (`app` + `trigger.event`): record + facts. */
export const defStartOutputs = (def: {
  app?: string | null;
  trigger?: { event: string } | null;
}): AppNodeIo[] => startOutputsOf(eventOf(def.app, def.trigger?.event));
