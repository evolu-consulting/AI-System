// CR-102 · com-c3 · phụ thuộc route community (dựng ở `community.mount.ts`).
import type { Tx } from "@ai/db";
import type { PackBell } from "../../kit/adapters/pack-bell";
import type { PackAccessView } from "../../kit/adapters/pack-guard.middleware";
import type { ExternalOrgResolver } from "../../kit/application/ext-org.ports";
import type { NotifyTxRepos } from "../../kit/application/notify";
import type { PackUow } from "../../kit/application/ports";
import type { HostBookReader, SupplierQuoteWriter } from "../application/pack-ports";
import type { CommunityEvents } from "./notify.events";

export type CommunityDeps = {
  view: PackAccessView;
  resolver: ExternalOrgResolver;
  uow: PackUow<{ tx: Tx } & NotifyTxRepos>;
  /** C9 · phát chuông (`emitComment` cho C6 gọi sau khi chèn bình luận). */
  events: CommunityEvents;
  /** C9 · chuông của chính người dùng (đọc + đánh dấu đã đọc). */
  bell: PackBell;
  /** Mở Sổ Hợp Tác (contracts-web) — chỉ chủ quản xem hồ sơ chủ quản. */
  shtUrl: string;
  /** ADR-0031: cổng ghi/đọc SP & Giá do `packs.mount.ts` tiêm; vắng ⇒ không Lưu báo giá / không gợi ý (route 503 / bỏ gợi ý). */
  quotes?: SupplierQuoteWriter | undefined;
  hostBook?: HostBookReader | undefined;
  /** Gốc URL community-web (link về bài ở SP & Giá); vắng ⇒ không link. */
  webUrl?: string | undefined;
};
