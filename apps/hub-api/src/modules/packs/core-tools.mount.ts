// Tách từ `packs.mount.ts` (trần 400 dòng): tool lõi chỉ đọc (app-guide + my-activity / my-chat-history) và gói `dlc` (dlc-engine ·
// khe thư viện + tool bước DLC; Agent Hub qua cầu `dlcAgents`). Phụ thuộc khai theo cấu trúc (không import `packs.mount.ts` ⇒ không
// vòng import); `PacksMountDeps` khớp kiểu này.
import type { Db } from "@ai/db";
import type { ConfigCache } from "../config/public";
import { mountGuide } from "../guide/guide.mount";
import { mountMyHistory } from "../my-history/my-history.mount";
import { contractsActivitySource } from "./contracts/activity.mount";
import { type AgentHubBridge, mountDlc } from "./dlc/dlc.mount";
import type { PackAccessView, PackRunsBridge, PackToolRegistry } from "./kit/public";
import { tenantTz } from "./packs.tenant-config";

export type CoreToolsDeps = {
  db: Db;
  config: ConfigCache;
  packTools?: PackToolRegistry;
  packs?: { contracts?: boolean };
  packRuns?: PackRunsBridge;
  dlcAgents?: AgentHubBridge;
};

/** Tool lõi chỉ đọc (không entitlement, tự lọc theo người gọi): app-guide + my-activity / my-chat-history (my-activity-rag). */
export function mountCoreTools(d: CoreToolsDeps, view: PackAccessView): void {
  mountGuide(d.db, d.packTools, view);
  const contractsOn = d.packs?.contracts ?? true;
  mountMyHistory(d.db, d.packTools, {
    view,
    timeZoneOf: tenantTz(d),
    sources: contractsOn ? [contractsActivitySource(d.db)] : [],
  });
}

/** dlc-engine · gói `dlc`: khe thư viện + tool bước DLC; cầu vắng (test khung) ⇒ khe vẫn đăng ký, bước báo chưa nối. */
export function mountDlcWired(d: CoreToolsDeps): void {
  mountDlc({ db: d.db, runs: d.packRuns ?? {}, hub: d.dlcAgents ?? {}, tools: d.packTools });
}
