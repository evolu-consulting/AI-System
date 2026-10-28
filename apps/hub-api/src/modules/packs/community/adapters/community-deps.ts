// CR-102 · com-c3 · phụ thuộc route community (dựng ở `community.mount.ts`).
import type { Tx } from "@ai/db";
import type { PackAccessView } from "../../kit/adapters/pack-guard.middleware";
import type { ExternalOrgResolver } from "../../kit/application/ext-org.ports";
import type { PackUow } from "../../kit/application/ports";

export type CommunityDeps = {
  view: PackAccessView;
  resolver: ExternalOrgResolver;
  uow: PackUow<{ tx: Tx }>;
  /** Mở Sổ Hợp Tác (contracts-web) — chỉ chủ quản xem hồ sơ chủ quản. */
  shtUrl: string;
};
