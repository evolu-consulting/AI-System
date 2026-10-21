// my-activity-rag · lớp 4: đăng ký `my-activity` + `my-chat-history` vào registry tool gói (gọi từ `mountPacks`). Đọc Hub qua
// `withHubScope({kind:"user"})` của NGƯỜI GỌI (RLS hội thoại); nguồn hoạt động của gói tiêm từ `packs.mount.ts` (`ActivitySource`,
// chạy bằng `PackUow` + RLS gói của người gọi); quyền gói người gọi từ `PackAccessView` (cache, 0 SQL khi nóng).
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { PackAccessView } from "../packs/kit/adapters/pack-guard.middleware";
import { packAccessInput } from "../packs/kit/adapters/pack-guard.middleware";
import type { ActivitySource } from "../packs/kit/application/activity.ports";
import type { PackToolDef } from "../packs/kit/application/pack-tools.ports";
import { checkPackAccess } from "../packs/kit/domain/pack-access.rules";
import { myAudit, retentionRaw, searchChat, userNames, type Who } from "./my-history.repo";
import { retentionMonths } from "./my-history.rules";
import { type MyHistoryDeps, myHistoryTools } from "./my-history.tools";

export type MyHistoryMountDeps = {
  view: PackAccessView;
  timeZoneOf(tenantId: string): Promise<string>;
  sources: readonly ActivitySource[];
  now?: () => Date;
};

const scope = (w: Who) => ({ kind: "user" as const, tenantId: w.tenantId, userId: w.userId });

export function myHistoryDeps(db: Db, m: MyHistoryMountDeps): MyHistoryDeps {
  return {
    now: m.now ?? (() => new Date()),
    timeZoneOf: m.timeZoneOf,
    sources: m.sources,
    chat: (w, q) =>
      withHubScope(
        db,
        scope(w),
        async (tx) => {
          const months = retentionMonths(await retentionRaw(tx, w.tenantId));
          return { months, rows: await searchChat(tx, w, { ...q, months }) };
        },
        { accessMode: "read only" },
      ),
    audit: (w, win) =>
      withHubScope(db, scope(w), (tx) => myAudit(tx, w, win), { accessMode: "read only" }),
    names: (w, ids) =>
      withHubScope(db, scope(w), (tx) => userNames(tx, w.tenantId, ids), {
        accessMode: "read only",
      }),
    canReadPack: async (w, pack) => {
      const i = await packAccessInput(m.view, pack, w);
      return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.read }) === "ok";
    },
  };
}

export function mountMyHistory(
  db: Db,
  tools: { register(t: PackToolDef): void } | undefined,
  m: MyHistoryMountDeps,
): void {
  if (!tools) return;
  for (const t of myHistoryTools(myHistoryDeps(db, m))) tools.register(t);
}
