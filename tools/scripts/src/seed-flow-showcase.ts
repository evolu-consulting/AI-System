// CR-103 · R4 fnr-showcase · seed flow mẫu "Duyệt đề nghị chi (mẫu)" cho tenant `demo` — LẶP LẠI ĐƯỢC (có rồi ⇒ bỏ qua).
//   bun tools/scripts/src/seed-flow-showcase.ts [--tenant demo] [--apply] [--i-know-prod]
//     [--legal-group pb-kinh-doanh] [--accounting-group pb-ke-toan] [--director-group pb-giam-doc]
// Mặc định CHẠY THỬ: in def (+ kết quả kiểm contracts) rồi thoát, không đụng DB. `--apply` cần DATABASE_URL (vai admin_api, tra
// tenant/Group/admin) + HUB_DATABASE_URL (vai hub_api, ghi `hub.process_defs`; vắng ⇒ dùng DATABASE_URL). Từ chối APP_ENV=production
// hoặc DB ngoài localhost/test trừ `--i-know-prod`; chỉ tenant `demo`. Def chỉ qua kiểm sau phase B (node `set`/`if` vào contracts).
import { ProcessDefInputSchema } from "@ai/contracts/hub-admin";
import { createDb, type Db, withScope } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { insertDef, keyTaken } from "../../../apps/hub-api/src/modules/processes/defs/defs.repo";
import { isLocalDbHost } from "./seed-community-demo.guard";
import {
  buildShowcaseDef,
  DEFAULT_GROUPS,
  flowSeedGuard,
  type GroupIds,
  type GroupKeys,
  SHOWCASE_NAME,
} from "./seed-flow-showcase.build";

const DEMO_KEY = "demo";
const TAG = "seed-flow-showcase";

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
  const parsed = ProcessDefInputSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      `${TAG}: def chưa hợp lệ với contracts hiện tại (cần phase B: node set/if) — ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join("."))
        .join(", ")}`,
    );
  return withHubScope(hub, { kind: "system" }, async (tx) => {
    if (await keyTaken(tx, f.tenantId, input.key)) return false;
    await insertDef(tx, {
      tenantId: f.tenantId,
      input: parsed.data as never,
      sourceTemplateId: null,
      ttlDays: null,
      actorId: f.actorId,
    });
    return true;
  });
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
  if (!argv.includes("--apply")) {
    // Dry-run: UUID giả cố định (đúng hình dạng) để in def + kiểm contracts; không đọc DB.
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
    const r = ProcessDefInputSchema.safeParse(def);
    console.log(
      r.success
        ? `${TAG}: def hợp lệ với contracts`
        : `${TAG}: def CHƯA qua contracts hiện tại (dự kiến chỉ node "if" tới khi fnr-if gộp): ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
    return;
  }
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
