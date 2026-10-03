// ADM-FR-53 · `config_version` trong transaction ghi cấu hình (spec M3 §3, M3-R15, plan §5.2). Chỉ làm việc DB: phát
// NOTIFY là việc của người gọi SAU khi hàm này trả (đã commit) — xem admin-api `lib/config/config-write.ts`.
import type { ConfigEvent } from "@ai/contracts";
import { sql } from "drizzle-orm";
import { type AuditInput, insertAuditRows } from "./audit-log";
import type { Db } from "./client";
import { type DbScope, type Tx, withScope } from "./scope";

/** `changed` ngay sau câu ghi có đổi hàng; `audit` cùng chỗ (plan M4 §4.1) — ghi sau bump, cùng transaction. */
export type ConfigSink = { changed(e: ConfigEvent): void; audit(e: AuditInput): void };
export type ConfigWriteOpts = {
  beforeBump?: () => Promise<void>;
  /**
   * Người thực hiện cho hàng audit (NULL = hệ thống). `undefined` mà `fn` có `ch.audit` → ném (lỗi lập trình). Có giá trị
   * → bật bất biến "có sự kiện ⇔ có audit" (lệch → `Error("audit/event mismatch")`, rollback).
   */
  actorId?: string | null;
  /**
   * Phiên bản gốc người gọi đã xem (import, plan-cd §2/D8): sau bump mà `v !== expectBase + 1` → ném
   * `ConfigVersionMoved {current: v - 1}` (rollback). Không có sự kiện (không bump) → không kiểm.
   */
  expectBase?: number;
};

/** Config đã đổi so với `expectBase` (ghi song song chen giữa) — người gọi đổi thành 409 `VERSION_CONFLICT`. */
export class ConfigVersionMoved extends Error {
  constructor(readonly current: number) {
    super("config_version moved");
    this.name = "ConfigVersionMoved";
  }
}
export type ConfigCommitted<T> = {
  result: T;
  version: number | null;
  events: readonly ConfigEvent[];
};

/**
 * Tăng `config_version` (hàng id=1) và trả giá trị mới. Phải là câu CUỐI của transaction (khoá hạng 14, plan §6),
 * chỉ trừ INSERT audit (hạng 15, không FK → không chờ): giữ khoá hàng tới commit rồi không chờ gì nữa → không nằm
 * trong vòng chờ. Upsert để hàng bị xoá tay vẫn chạy.
 */
export async function bumpConfigVersion(tx: Tx): Promise<number> {
  const rows = await tx.execute(sql`
    insert into admin.config_meta (id, config_version, updated_at) values (1, 1, now())
    on conflict (id) do update
      set config_version = admin.config_meta.config_version + 1, updated_at = now()
    returning config_version`);
  const v = (rows as unknown as { config_version: number }[])[0]?.config_version;
  if (typeof v !== "number") throw new Error("config_meta: không đọc được config_version sau bump");
  return v;
}

/** Không khoá; hàng thiếu → 0. */
export async function readConfigVersion(tx: Tx): Promise<number> {
  const rows = await tx.execute(sql`select config_version from admin.config_meta where id = 1`);
  return (rows as unknown as { config_version: number }[])[0]?.config_version ?? 0;
}

/**
 * `withScope` + sink sự kiện/audit tạo MỚI mỗi lần thử (retry 40P01/40001 bỏ cả sự kiện lẫn audit của lần hỏng). `fn`
 * xong: có sự kiện → `beforeBump` (điểm dừng test) → bump (hạng 14); rồi audit một câu INSERT (hạng 15, không chờ gì)
 * với `config_version` = bản mới (NULL nếu không bump).
 */
export async function withConfigWrite<T>(
  db: Db,
  scope: DbScope,
  fn: (tx: Tx, ch: ConfigSink) => Promise<T>,
  opts: ConfigWriteOpts = {},
): Promise<ConfigCommitted<T>> {
  return withScope(db, scope, async (tx) => {
    const events: ConfigEvent[] = [];
    const audits: AuditInput[] = [];
    const result = await fn(tx, { changed: (e) => events.push(e), audit: (e) => audits.push(e) });
    // Bất biến (plan M4 §4.1, T1c): nơi gọi có audit (actorId) thì có sự kiện ⇔ có audit — sai = module sót `ch.audit`.
    if (opts.actorId !== undefined && events.length > 0 !== audits.length > 0)
      throw new Error("audit/event mismatch");
    let version: number | null = null;
    if (events.length > 0) {
      await opts.beforeBump?.();
      version = await bumpConfigVersion(tx);
      if (opts.expectBase !== undefined && version !== opts.expectBase + 1)
        throw new ConfigVersionMoved(version - 1);
    }
    if (audits.length > 0) {
      if (opts.actorId === undefined) throw new Error("configWrite: ch.audit cần actorId");
      await insertAuditRows(tx, audits, { actorId: opts.actorId, v: version });
    }
    return { result, version, events };
  });
}
