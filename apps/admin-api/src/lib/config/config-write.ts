// ADM-FR-53 · ghi cấu hình + NOTIFY `config_changed` SAU commit (spec M3 §3, M3-R15/R16, plan §5.2, TECH-DEBT #13).
// Một request = đúng một `configWrite` (helper nội bộ nhận `(tx, ch)`, không lồng withScope/configWrite).
import { CONFIG_CHANNEL, type ConfigEvent, configChangedPayload } from "@ai/contracts";
import { type ConfigSink, type Db, type DbScope, type Tx, withConfigWrite } from "@ai/db";
import { logger } from "../logger";
import { safeErrorFields } from "../pg-errors";
import { afterLock, type HookOp, type TestHooks } from "../test-hooks";

/** `actor` = người thực hiện cho hàng audit (plan M4 §4.1); bắt buộc ở mọi nơi gọi. */
export type ConfigCall = {
  ctx: { db: Db; hooks?: TestHooks };
  scope: DbScope;
  actor: { userId: string };
  /** Import (plan-cd §2): bump mà config đã đi khác `expectBase + 1` → ném `ConfigVersionMoved` (rollback). */
  expectBase?: number;
};
export type { ConfigSink };

/**
 * `pg_notify` một lần, ngoài transaction. Lỗi gửi chỉ log (dữ liệu đã commit; Hub có đường dự phòng đọc `config_meta`),
 * không bao giờ ném ra response.
 */
export async function publishConfigChanged(
  db: Db,
  v: number,
  events: readonly ConfigEvent[],
): Promise<void> {
  try {
    await db.notify(CONFIG_CHANNEL, JSON.stringify(configChangedPayload(v, events)));
  } catch (err) {
    logger.error("config_changed notify failed", { module: "config", v, ...safeErrorFields(err) });
  }
}

/**
 * Transaction ghi cấu hình: `fn` chỉ làm việc DB và gọi `ch.changed(...)` (+ `ch.audit(auditOf(...))`) ngay sau câu ghi
 * có đổi hàng; audit ghi sau bump, cùng transaction. Đã commit và có sự kiện → NOTIFY đúng một lần. Ném (luật,
 * rollback) → không NOTIFY, không audit; retry 40P01 → sự kiện và audit của lần hỏng bị bỏ.
 */
export async function configWrite<T>(
  c: ConfigCall,
  op: HookOp,
  fn: (tx: Tx, ch: ConfigSink) => Promise<T>,
): Promise<T> {
  const hooks = c.ctx.hooks;
  const r = await withConfigWrite(c.ctx.db, c.scope, fn, {
    beforeBump: hooks ? () => afterLock(hooks, op, "bump") : undefined,
    actorId: c.actor.userId,
    expectBase: c.expectBase,
  });
  if (r.version !== null) await publishConfigChanged(c.ctx.db, r.version, r.events);
  return r.result;
}
