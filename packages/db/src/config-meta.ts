// ADM-FR-53 · `config_version` trong transaction ghi cấu hình (spec M3 §3, M3-R15, plan §5.2). Chỉ làm việc DB: phát
// NOTIFY là việc của người gọi SAU khi hàm này trả (đã commit) — xem admin-api `lib/config/config-write.ts`.
import type { ConfigEvent } from "@ai/contracts";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { type DbScope, type Tx, withScope } from "./scope";

export type ConfigSink = { changed(e: ConfigEvent): void };
export type ConfigCommitted<T> = {
  result: T;
  version: number | null;
  events: readonly ConfigEvent[];
};

/**
 * Tăng `config_version` (hàng id=1) và trả giá trị mới. Phải là câu CUỐI của transaction (khoá hạng 14, plan §6):
 * giữ khoá hàng tới commit rồi không chờ gì nữa → không nằm trong vòng chờ. Upsert để hàng bị xoá tay vẫn chạy.
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
 * `withScope` + sink sự kiện tạo MỚI mỗi lần thử (retry 40P01/40001 bỏ sự kiện của lần hỏng). `fn` xong: có sự kiện →
 * `beforeBump` (điểm dừng test) → bump (câu cuối); không có → không bump, `version = null`.
 */
export async function withConfigWrite<T>(
  db: Db,
  scope: DbScope,
  fn: (tx: Tx, ch: ConfigSink) => Promise<T>,
  opts: { beforeBump?: () => Promise<void> } = {},
): Promise<ConfigCommitted<T>> {
  return withScope(db, scope, async (tx) => {
    const events: ConfigEvent[] = [];
    const result = await fn(tx, { changed: (e) => events.push(e) });
    if (events.length === 0) return { result, version: null, events };
    await opts.beforeBump?.();
    return { result, version: await bumpConfigVersion(tx), events };
  });
}
