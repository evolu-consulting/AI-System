// CR-118 · cr118-boot-packs · phần tuỳ chọn của schema mà ConfigCache đọc: `packs.pack_agents` (migration gói), cột
// `admin.users.default_app` (GRANT admin 0033), `admin.tenants.default_app`, `admin.config_meta.profile_version` (admin 0034).
// Stack chỉ chạy migration Hub (e2e đóng băng: chat-x2a, K1, P-*…) thiếu các phần này ⇒ Hub KHÔNG được chết lúc khởi động:
// dò MỘT lần mỗi kết nối `Db` (một câu, lúc nạp đầu), thiếu ⇒ đóng an toàn (không agent gói, default_app null, profile 0) +
// MỘT dòng cảnh báo. Nóng 0 SQL thêm (promise nhớ). Migrate sau khi Hub đã chạy ⇒ cần khởi động lại để thấy.
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import { logger } from "../../lib/logger";

export type HubSchemaCaps = {
  packAgents: boolean;
  userDefaultApp: boolean;
  tenantDefaultApp: boolean;
  profileVersion: boolean;
};
type Row = { pa: boolean; uda: boolean; tda: boolean; pv: boolean };

const memo = new WeakMap<Db, Promise<HubSchemaCaps>>();

const col = (t: string, c: string) =>
  sql`exists (select 1 from information_schema.columns
    where table_schema = 'admin' and table_name = ${t} and column_name = ${c})`;

async function probe(db: Db): Promise<HubSchemaCaps> {
  // information_schema chỉ hiện cột role có quyền ⇒ đúng điều Hub đọc được; has_table_privilege(null) = null ⇒ false.
  const [r] = await db.db.execute<Row>(sql`select
      coalesce(has_table_privilege(to_regclass('packs.pack_agents')::oid, 'SELECT'), false) as pa,
      ${col("users", "default_app")} as uda,
      ${col("tenants", "default_app")} as tda,
      ${col("config_meta", "profile_version")} as pv`);
  const caps: HubSchemaCaps = {
    packAgents: r?.pa === true,
    userDefaultApp: r?.uda === true,
    tenantDefaultApp: r?.tda === true,
    profileVersion: r?.pv === true,
  };
  const missing = Object.entries(caps)
    .filter(([, on]) => !on)
    .map(([k]) => k);
  if (missing.length > 0)
    logger.warn("hub-schema-optional-missing", { missing, hint: "bun run db:migrate" });
  return caps;
}

/** Nhớ theo `Db`; lỗi dò ⇒ không nhớ (lần sau dò lại). */
export function hubSchemaCaps(db: Db): Promise<HubSchemaCaps> {
  const hit = memo.get(db);
  if (hit) return hit;
  const p = probe(db);
  memo.set(db, p);
  p.catch(() => {
    if (memo.get(db) === p) memo.delete(db);
  });
  return p;
}
