// HUB-FR-69 · H4a-R09 · plan P5–P7, §5.1, §7 · MỌI ghi cấu hình Studio đi qua `withConfigWrite`: một transaction scope
// `system` (P6) → khoá `config_meta` FOR UPDATE ĐẦU TIÊN → `fn` (đọc FOR UPDATE hàng đích, kiểm version, ghi) → bump
// `hub_config_version` → audit → NOTIFY (giao khi commit). Ném bất kỳ (kể cả audit lỗi — P7) ⇒ rollback cả gói.
import type { Tx } from "@ai/db";
import { type HubScope, withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import type { HubAuditRow, HubAuditWriter } from "../../lib/hub-audit";
import { bumpHubConfig, lockHubConfig, notifyHubConfig } from "../../lib/hub-config-write";

export type StudioWriteDeps = { db: Db; audit: HubAuditWriter };
/** Phần audit nghiệp vụ tự điền; actor + `hubConfigVersion` do helper điền. */
export type StudioAudit = Omit<
  HubAuditRow,
  "hubConfigVersion" | "actorId" | "actorUsername" | "actorRole"
>;
export type WriteOutcome<T> = { result: T; audit: StudioAudit | null };
export type WriteResult<T> = { result: T; version: number };

/** Tên người thao tác cho audit (dùng lại ở audit không bump, vd `provider.check`). */
export async function username(tx: Tx, userId: string): Promise<string | null> {
  const [r] = await tx.execute<{ username: string }>(
    sql`select username from admin.users where id = ${userId}`,
  );
  return r?.username ?? null;
}

/**
 * `fn` nhận `v0` (version đang khoá). `audit: null` ⇒ không đổi gì: không bump/audit/NOTIFY, trả `v0`.
 * Retry 40P01/40001 an toàn: NOTIFY chỉ giao khi commit (Q-K7 H3b).
 * H4b-1 D8 · `scope` mặc định `system`; route tenant (secrets) truyền scope `user` của tenant đích ⇒ RLS chặn thêm một lớp.
 */
export function withConfigWrite<T>(
  deps: StudioWriteDeps,
  actor: AuthUser,
  fn: (tx: Tx, v0: number) => Promise<WriteOutcome<T>>,
  scope: HubScope = { kind: "system" },
): Promise<WriteResult<T>> {
  return withHubScope(deps.db, scope, async (tx) => {
    const v0 = await lockHubConfig(tx);
    const out = await fn(tx, v0);
    if (out.audit === null) return { result: out.result, version: v0 };
    const v1 = await bumpHubConfig(tx);
    await deps.audit.insert(tx, {
      ...out.audit,
      actorId: actor.userId,
      actorUsername: await username(tx, actor.userId),
      actorRole: actor.role,
      hubConfigVersion: v1,
    });
    await notifyHubConfig(tx, v1);
    return { result: out.result, version: v1 };
  });
}
