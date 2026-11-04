// CR-118 · cr118-boot-packs + cr118-schema-caps-prod · phần tuỳ chọn của schema mà ConfigCache đọc: `packs.pack_agents`
// (migration gói), cột `admin.users.default_app` (GRANT admin 0033), `admin.tenants.default_app`,
// `admin.config_meta.profile_version` (admin 0034). Dò MỘT câu mỗi kết nối `Db` (promise nhớ ⇒ nóng 0 SQL thêm).
// - production (`APP_ENV`): thiếu ⇒ `assertHubSchemaCaps` ném lúc boot (server.ts exit 1, liệt kê phần thiếu) — không được
//   lặng lẽ mất agent gói / ngừng bump profile.
// - khác (stack test chỉ migrate Hub: chat-x2a, K1, P-*…): đóng an toàn (không agent gói, default_app null, profile 0) +
//   cảnh báo khi tập thiếu đổi; mỗi lần ConfigCache nạp lại mà còn thiếu thì dò lại (`refreshHubSchemaCaps`) ⇒ migrate sau khi
//   Hub đã chạy được nhận không cần khởi động lại; đủ rồi thì không dò nữa (0 SQL thêm).
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
const warned = new WeakMap<Db, string>();

const col = (t: string, c: string) =>
  sql`exists (select 1 from information_schema.columns
    where table_schema = 'admin' and table_name = ${t} and column_name = ${c})`;

/** Tên phần còn thiếu (thứ tự cố định); đủ ⇒ []. */
export function missingCaps(caps: HubSchemaCaps): string[] {
  return Object.entries(caps)
    .filter(([, on]) => !on)
    .map(([k]) => k);
}

/** Quyết định lúc boot: production thiếu ⇒ "fatal"; khác thiếu ⇒ "warn"; đủ ⇒ "ok". */
export function schemaCapsVerdict(appEnv: string, caps: HubSchemaCaps): "ok" | "warn" | "fatal" {
  if (missingCaps(caps).length === 0) return "ok";
  return appEnv === "production" ? "fatal" : "warn";
}

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
  const missing = missingCaps(caps);
  const key = missing.join(",");
  if (missing.length > 0 && warned.get(db) !== key)
    logger.warn("hub-schema-optional-missing", { missing, hint: "bun run db:migrate" });
  warned.set(db, key);
  return caps;
}

function remember(db: Db, p: Promise<HubSchemaCaps>): Promise<HubSchemaCaps> {
  memo.set(db, p);
  p.catch(() => {
    if (memo.get(db) === p) memo.delete(db);
  });
  return p;
}

/** Nhớ theo `Db`; lỗi dò ⇒ không nhớ (lần sau dò lại). */
export function hubSchemaCaps(db: Db): Promise<HubSchemaCaps> {
  return memo.get(db) ?? remember(db, probe(db));
}

/** Đường nạp lại: còn thiếu ⇒ dò lại một câu (lỗi dò ⇒ giữ kết quả cũ); đủ ⇒ không SQL. */
export async function refreshHubSchemaCaps(db: Db): Promise<HubSchemaCaps> {
  const cur = await hubSchemaCaps(db);
  if (missingCaps(cur).length === 0) return cur;
  try {
    return await remember(db, probe(db));
  } catch {
    memo.set(db, Promise.resolve(cur));
    return cur;
  }
}

/** Boot (server.ts): production thiếu ⇒ ném lỗi liệt kê phần thiếu; khác ⇒ trả caps (đã cảnh báo). */
export async function assertHubSchemaCaps(appEnv: string, db: Db): Promise<HubSchemaCaps> {
  const caps = await hubSchemaCaps(db);
  if (schemaCapsVerdict(appEnv, caps) === "fatal")
    throw new Error(
      `hub schema thiếu (production): ${missingCaps(caps).join(", ")} — chạy bun run db:migrate (gói + admin)`,
    );
  return caps;
}
