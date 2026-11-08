// CR-121 c18 (D1 + D5) · int: migration admin 0037 — cột `admin.features.app` (nguồn duy nhất feature → ứng dụng) + gỡ feature
// `contracts-approval-engine`. Backfill kiểm bằng cách đưa dữ liệu về dạng TRƯỚC 0037 (app = NULL, còn feature engine + entitlement)
// rồi chạy lại đúng các câu của file 0037 (idempotent). Toàn bộ trong MỘT giao dịch rồi ROLLBACK ⇒ không để lại gì.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { readJournal } from "./migrate-guard";

const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const sql = postgres(URL, { max: 1, onnotice: () => {} });

const here = (p: string) => fileURLToPath(new globalThis.URL(p, import.meta.url));
const stmts0037 = readFileSync(here("../migrations/0037_feature_app_col.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const ROLLBACK = new Error("rollback");
const SUFFIX = Math.random().toString(36).slice(2, 8);
const name = (k: string) => ({ vi: k, en: k });

beforeAll(async () => {
  await runMigrations({ url: URL, appEnv: "test" });
});
afterAll(() => sql.end());

describe("CR-121 c18 · admin 0037 · journal", () => {
  test("0037 nằm trong journal admin ngay sau 0036, `when` lớn hơn 0036 (đúng thứ tự)", () => {
    const j = readJournal(here("../migrations"));
    const i = j.findIndex((e) => e.tag === "0037_feature_app_col");
    const last = j[i];
    const prev = j[i - 1];
    expect(i).toBeGreaterThan(0);
    expect(prev?.tag).toBe("0036_tenants_profile_revoke_hub_ro");
    expect((last?.when ?? 0) > (prev?.when ?? Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe("CR-121 c18 · admin 0037 · backfill + gỡ engine", () => {
  test("backfill theo quy ước (han-muc-duyet → contracts), gỡ engine + entitlement mồ côi kèm audit, NOT NULL/CHECK/trigger", async () => {
    const keys: Record<string, string> = {
      core: "core",
      "chat-app": "chat",
      "community-write": "community",
      "contracts-read": "contracts",
      "han-muc-duyet": "contracts",
      "knowledge-admin": "knowledge",
      [`ke-toan-${SUFFIX}`]: "other",
    };
    let result: Record<string, unknown> = {};
    await sql
      .begin(async (tx) => {
        // Dạng TRƯỚC 0037: không có NOT NULL, mọi app NULL; còn feature engine + entitlement của một công ty.
        await tx`alter table admin.features alter column app drop not null`;
        for (const k of Object.keys(keys))
          await tx`insert into admin.features (key, name) values (${k}, ${tx.json(name(k))})
            on conflict (key) do nothing`;
        await tx`insert into admin.features (key, name) values ('contracts-approval-engine', ${tx.json(name("engine"))})
          on conflict (key) do nothing`;
        const [t] = await tx<{ id: string }[]>`
          insert into admin.tenants (key, name) values (${`c18-${SUFFIX}`}, 'C18') returning id`;
        const tid = t?.id as string;
        await tx`insert into admin.feature_entitlements (feature_id, tenant_id)
          select id, ${tid} from admin.features where key = 'contracts-approval-engine'
          on conflict (feature_id, tenant_id) do nothing`;
        // Cấp phép nhóm + quota riêng của engine: phải bị xoá tường minh kèm audit theo công ty.
        const [grp] = await tx<{ id: string }[]>`
          insert into admin.groups (tenant_id, key, name) values (${tid}, 'c18-g', ${tx.json({ vi: "G" })}) returning id`;
        const gid = grp?.id as string;
        await tx`insert into admin.feature_grants (tenant_id, feature_id, group_id)
          select ${tid}, id, ${gid} from admin.features where key = 'contracts-approval-engine'`;
        await tx`insert into admin.tenant_quotas (tenant_id, feature_id, max_runs)
          select ${tid}, id, 5 from admin.features where key = 'contracts-approval-engine'`;
        await tx`update admin.features set app = null`;

        for (const s of stmts0037) await tx.unsafe(s);

        const apps = await tx<{ key: string; app: string }[]>`
          select key, app from admin.features where key = any(${Object.keys(keys)})`;
        const [eng] = await tx<{ f: number }[]>`
          select count(*)::int as f from admin.features where key = 'contracts-approval-engine'`;
        const tenantAudit = await tx<{ entity: string; summary: Record<string, unknown> }[]>`
          select entity, summary from admin.audit_log
          where tenant_id = ${tid} and entity_name = 'contracts-approval-engine' order by entity`;
        const [fa] = await tx<{ k: string | null; c: number }[]>`
          select (select before->>'key' from admin.audit_log where entity = 'feature' and entity_name = 'contracts-approval-engine'
                    and before is not null order by seq desc limit 1) as k,
            (select count(*)::int from admin.feature_grants g join admin.tenants x on x.id = g.tenant_id where x.id = ${tid}) as c`;
        const [nul] = await tx<{ n: number; notnull: boolean }[]>`
          select (select count(*) from admin.features where app is null)::int as n,
            (select attnotnull from pg_attribute where attrelid = 'admin.features'::regclass and attname = 'app') as notnull`;
        // Chạy lại lần hai ⇒ vô hại (idempotent).
        for (const s of stmts0037) await tx.unsafe(s);
        // Trigger điền app khi INSERT SQL thẳng không nêu app (cài gói, seed).
        const [ins] = await tx<{ app: string }[]>`
          insert into admin.features (key, name) values (${`knowledge-x${SUFFIX}`}, ${tx.json(name("x"))}) returning app`;
        result = { apps, eng, nul, ins, tenantAudit, fa };
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });

    const r = result as {
      apps: { key: string; app: string }[];
      eng: { f: number };
      nul: { n: number; notnull: boolean };
      ins: { app: string };
      tenantAudit: { entity: string; summary: Record<string, unknown> }[];
      fa: { k: string | null; c: number };
    };
    expect(Object.fromEntries(r.apps.map((x) => [x.key, x.app]))).toEqual(keys);
    expect(r.eng.f).toBe(0); // engine đã gỡ
    // Audit theo công ty: entitlement + grant + quota đều có dòng riêng (không cascade lặng lẽ); grant/quota nêu số dòng.
    expect(r.tenantAudit.map((x) => x.entity)).toEqual(["entitlement", "grant", "quota"]);
    expect(r.tenantAudit.find((x) => x.entity === "grant")?.summary.rows).toBe(1);
    expect(r.tenantAudit.find((x) => x.entity === "quota")?.summary).toMatchObject({
      quotas: 1,
      alerts: 0,
    });
    expect(r.fa.c).toBe(0); // grant đã xoá
    expect(r.fa.k).toBe("contracts-approval-engine"); // audit feature có efore để khôi phục
    expect(r.nul).toEqual({ n: 0, notnull: true });
    expect(r.ins.app).toBe("knowledge");
  });

  test("CHECK chặn app ngoài tập; app tường minh được giữ (không bị trigger ghi đè)", async () => {
    const bad = await sql`insert into admin.features (key, name, app)
      values (${`bad-${SUFFIX}`}, ${sql.json(name("b"))}, 'billing')`.then(
      () => null,
      (e: { code?: string }) => e,
    );
    expect((bad as { code?: string } | null)?.code).toBe("23514");
    const key = `zz-${SUFFIX}`;
    try {
      const [r] = await sql<{ app: string }[]>`
        insert into admin.features (key, name, app) values (${key}, ${sql.json(name("z"))}, 'contracts') returning app`;
      expect(r?.app).toBe("contracts");
    } finally {
      await sql`delete from admin.features where key = ${key}`;
    }
  });
});
