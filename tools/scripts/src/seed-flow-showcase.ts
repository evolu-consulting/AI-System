// CR-103 · R4 fnr-showcase · seed flow mẫu "Duyệt đề nghị chi (mẫu)" cho tenant `demo` — LẶP LẠI ĐƯỢC (có rồi ⇒ bỏ qua).
//   bun tools/scripts/src/seed-flow-showcase.ts [--tenant demo] [--apply] [--i-know-prod]
//     [--legal-group pb-kinh-doanh] [--accounting-group pb-ke-toan] [--director-group pb-giam-doc] [--admin demo-owner]
// `--admin a,b`: user nội bộ được thêm vào cả 3 Group duyệt (mặc định demo-owner) — route quy trình chế độ admin chỉ cho admin gọi `/review-tasks`.
// Mặc định CHẠY THỬ: in def (+ kết quả kiểm contracts) rồi thoát, không đụng DB. `--apply` cần DATABASE_URL (vai admin_api, tra
// tenant/Group/admin) + HUB_DATABASE_URL (vai hub_api, ghi `hub.process_defs`; vắng ⇒ dùng DATABASE_URL). Từ chối APP_ENV=production
// hoặc DB ngoài localhost/test trừ `--i-know-prod`; chỉ tenant `demo`. Def chỉ qua kiểm sau phase B (node `set`/`if` vào contracts).
import { createDb, type Db, withScope } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { insertDef, keyTaken } from "../../../apps/hub-api/src/modules/processes/defs/defs.repo";
import { loadDefRefs } from "../../../apps/hub-api/src/modules/processes/defs/teams.repo";
import { grantGroup } from "./seed-community-demo.grant";
import { isLocalDbHost } from "./seed-community-demo.guard";
import {
  buildShowcaseDef,
  DEFAULT_GROUPS,
  flowSeedGuard,
  type GroupIds,
  type GroupKeys,
  SHOWCASE_NAME,
} from "./seed-flow-showcase.build";
import { checkShowcase, dryRunRefs } from "./seed-flow-showcase.check";

const DEMO_KEY = "demo";
const TAG = "seed-flow-showcase";
/** Admin demo mặc định sẽ bấm "Chạy thử" (ghi đè bằng `--admin a,b`). */
const DEFAULT_ADMIN = "demo-owner";

type Found = { tenantId: string; actorId: string; groups: GroupIds };

/** Tra tenant, tenant_admin active đầu tiên và id 3 Group theo key — thiếu cái nào ⇒ lỗi rõ. */
async function lookup(db: Db, tenantKey: string, keys: GroupKeys): Promise<Found> {
  return withScope(db, { kind: "platform" }, async (tx) => {
    const [t] = (await tx.execute(
      sql`select id from admin.tenants where key = ${tenantKey}`,
    )) as unknown as { id: string }[];
    if (!t) throw new Error(`${TAG}: không có tenant "${tenantKey}"`);
    const [u] = (await tx.execute(sql`select id from admin.users
      where tenant_id = ${t.id} and kind = 'internal' and role = 'tenant_admin' and active
      order by created_at, id limit 1`)) as unknown as { id: string }[];
    if (!u) throw new Error(`${TAG}: tenant "${tenantKey}" chưa có tenant_admin`);
    const groups = {} as Record<keyof GroupKeys, string>;
    for (const k of Object.keys(keys) as (keyof GroupKeys)[]) {
      const [g] = (await tx.execute(
        sql`select id from admin.groups where tenant_id = ${t.id} and key = ${keys[k]}`,
      )) as unknown as { id: string }[];
      if (!g)
        throw new Error(`${TAG}: tenant "${tenantKey}" không có Group "${keys[k]}" (--${k}-group)`);
      groups[k] = g.id;
    }
    return { tenantId: t.id, actorId: u.id, groups };
  });
}

async function apply(hub: Db, f: Found): Promise<boolean> {
  const input = buildShowcaseDef(f.groups);
  return withHubScope(hub, { kind: "system" }, async (tx) => {
    if (await keyTaken(tx, f.tenantId, input.key)) return false;
    // Cùng kiểm + ép trường như `POST /process-defs` (refs thật của tenant: Group còn sống, v.v.).
    const c = checkShowcase(input, await loadDefRefs(tx, f.tenantId));
    if (!c.ok) throw new Error(`${TAG}: def không hợp lệ — ${c.issues.join("; ")}`);
    await insertDef(tx, {
      tenantId: f.tenantId,
      input: c.def,
      sourceTemplateId: null,
      ttlDays: null,
      actorId: f.actorId,
    });
    return true;
  });
}

/** Admin bấm "Chạy thử" phải thuộc cả 3 Group duyệt (chế độ route admin: chỉ admin gọi `/review-tasks`). Idempotent. */
async function grantReviewers(
  db: Db,
  tenantKey: string,
  keys: GroupKeys,
  users: readonly string[],
) {
  const added: string[] = [];
  for (const g of new Set(Object.values(keys)))
    for (const u of await grantGroup(db, tenantKey, g, users)) added.push(`${u}→${g}`);
  return added;
}
/** Dry-run: UUID giả cố định (đúng hình dạng) để in def + kiểm như API lưu; không đọc DB. */
function dryRun(tenantKey: string, keys: GroupKeys, admins: readonly string[]): void {
  const fake: GroupIds = {
    legal: "7a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c01",
    accounting: "7a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c02",
    director: "7a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c03",
  };
  const def = buildShowcaseDef(fake);
  console.log(
    `${TAG}: chạy thử — tenant "${tenantKey}", flow "${SHOWCASE_NAME}" (thêm --apply để ghi)`,
  );
  console.log(JSON.stringify(def, null, 2));
  const c = checkShowcase(def, dryRunRefs(Object.values(fake)));
  console.log(
    c.ok
      ? `${TAG}: def hợp lệ (contracts + luật def + ép trường như API lưu)`
      : `${TAG}: def CHƯA hợp lệ — ${c.issues.join("; ")}`,
  );
  const groups = [...new Set(Object.values(keys))].join(", ");
  console.log(`${TAG}: --apply sẽ thêm ${admins.join(", ")} vào ${groups}`);
}

async function main(argv: readonly string[]): Promise<void> {
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const tenantKey = arg("--tenant") ?? DEMO_KEY;
  if (tenantKey !== DEMO_KEY)
    throw new Error(`${TAG}: từ chối tenant "${tenantKey}" — chỉ "${DEMO_KEY}"`);
  const keys: GroupKeys = {
    legal: arg("--legal-group") ?? DEFAULT_GROUPS.legal,
    accounting: arg("--accounting-group") ?? DEFAULT_GROUPS.accounting,
    director: arg("--director-group") ?? DEFAULT_GROUPS.director,
  };
  const admins = (arg("--admin") ?? DEFAULT_ADMIN)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!argv.includes("--apply")) return dryRun(tenantKey, keys, admins);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`${TAG}: cần DATABASE_URL`);
  const hubUrl = process.env.HUB_DATABASE_URL ?? url;
  const why = flowSeedGuard({
    appEnv: process.env.APP_ENV,
    urls: [url, hubUrl],
    iKnowProd: argv.includes("--i-know-prod"),
    isLocal: isLocalDbHost,
  });
  if (why) throw new Error(`${TAG}: từ chối — ${why}`);
  const db = createDb(url, { max: 2 });
  const hub = hubUrl === url ? db : createDb(hubUrl, { max: 2 });
  try {
    const found = await lookup(db, tenantKey, keys);
    console.log(
      `${TAG}: ${(await apply(hub, found)) ? "đã tạo flow mẫu" : "flow mẫu đã có — bỏ qua"}`,
    );
    const added = await grantReviewers(db, tenantKey, keys, admins);
    console.log(`${TAG}: thêm vào nhóm duyệt: ${added.join(", ") || "(đã đủ)"}`);
  } finally {
    if (hub !== db) await hub.close();
    await db.close();
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
