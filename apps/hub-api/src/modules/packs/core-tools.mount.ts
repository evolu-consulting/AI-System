// Tách từ `packs.mount.ts` (trần 400 dòng): tool lõi chỉ đọc (app-guide + my-activity / my-chat-history) và gói `dlc` (dlc-engine ·
// khe thư viện + tool bước DLC; Agent Hub qua cầu `dlcAgents`). Nối ở đây vì cần `PacksMountDeps` (cầu, registry tool).
import type { Db } from "@ai/db";
import { mountGuide } from "../guide/guide.mount";
import { mountMyHistory } from "../my-history/my-history.mount";
import { contractsActivitySource } from "./contracts/activity.mount";
import { mountDlc } from "./dlc/dlc.mount";
import type { PackAccessView } from "./kit/adapters/pack-guard.middleware";
import type { PacksMountDeps } from "./packs.mount";
import { tenantTz } from "./packs.tenant-config";

/** Tool lõi chỉ đọc (không entitlement, tự lọc theo người gọi): app-guide + my-activity / my-chat-history (my-activity-rag). */
export function mountCoreTools(d: PacksMountDeps & { db: Db }, view: PackAccessView): void {
  mountGuide(d.db, d.packTools, view);
  const contractsOn = d.packs?.contracts ?? true;
  mountMyHistory(d.db, d.packTools, {
    view,
    timeZoneOf: tenantTz(d),
    sources: contractsOn ? [contractsActivitySource(d.db)] : [],
  });
}

/** dlc-engine · gói `dlc`: khe thư viện + tool bước DLC; cầu vắng (test khung) ⇒ khe vẫn đăng ký, bước báo chưa nối. */
export function mountDlcWired(d: PacksMountDeps & { db: Db }): void {
  mountDlc({ db: d.db, runs: d.packRuns ?? {}, hub: d.dlcAgents ?? {}, tools: d.packTools });
}
