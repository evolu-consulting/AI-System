// CR-191 · community 0025 «Ai thấy bài»: `aud_tenants` (≤ 200) + mức `internal`. Hai đường: (A) tiến từ bản hiện tại (gói community ≤ 0022 + bài cũ
// đủ mức ⇒ sau migrate bài cũ nguyên mức, không mất người xem, chạy lại vô hại); (B) từ đầu (DB trống) ra cùng lược đồ. Rồi CHECK + SQL `audience_ok`
// khớp bảng chân trị dùng chung (`tests/acceptance/com-c3/_support/audience-truth.ts`) cho mọi người xem là đối tác.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { TRUTH } from "../../../tests/acceptance/com-c3/_support/audience-truth";
import { runMigrations } from "./migrate";
import { runHubMigrations, withMigrateLock } from "./migrate-hub";
import { PACKS_KIT_TABLE, runPackMigrations } from "./migrate-packs";
import { withDatabase } from "./test-db";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OLD_DB = "ai_system_cr191aud_old";
const NEW_DB = "ai_system_cr191aud_new";
const urlOf = (db: string) => withDatabase(BASE, db);
const dbDir = (name: string) => fileURLToPath(new globalThis.URL(`../${name}`, import.meta.url));
const tmpRoot = mkdtempSync(join(tmpdir(), "cr191-aud-"));
const T = "01900000-0000-7000-8000-00000191a001";
const U = "01900000-0000-7000-8000-00000191a002";
const ORG = "01900000-0000-7000-8000-00000191a003";

/** Bản sao thư mục migration, journal chỉ giữ migration số ≤ `maxNo` (DB đang ở bản cũ). */
function truncated(name: string, maxNo: number): string {
  const dest = join(tmpRoot, name);
  cpSync(dbDir(name), dest, { recursive: true });
  const jf = join(dest, "meta", "_journal.json");
  const j = JSON.parse(readFileSync(jf, "utf8")) as { entries: { tag: string }[] };
  j.entries = j.entries.filter((e) => Number.parseInt(e.tag.slice(0, 4), 10) <= maxNo);
  writeFileSync(jf, JSON.stringify(j));
  return dest;
}
async function applyDir(url: string, folder: string, table: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await withMigrateLock(url, () =>
      migrate(drizzle(sql), { migrationsFolder: folder, migrationsTable: table }),
    );
  } finally {
    await sql.end();
  }
}
async function recreate(db: string): Promise<void> {
  const m = postgres(withDatabase(BASE as string, "postgres"), { max: 1, onnotice: () => {} });
  try {
    await m.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await m.unsafe(`CREATE DATABASE "${db}"`);
  } finally {
    await m.end();
  }
}
const migrateAll = async (url: string) => {
  await runMigrations({ url, appEnv: "test" });
  await runHubMigrations({ url, appEnv: "test" });
  return runPackMigrations({ url, appEnv: "test" });
};

let oldDb: postgres.Sql;
let newDb: postgres.Sql;

/** Bài cũ (trước 0025): chủ quản đủ mức + một bài đối tác. Chèn bằng owner, bỏ FK/RLS như các int migrate khác. */
async function seedOld(sql: postgres.Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const base = (key: string, org: string | null, mode: string | null, orgs: string[] = []) =>
      tx`insert into community.posts (tenant_id, type, author_user_id, author_name, author_org, title_raw, title_masked,
          body_raw, body_masked, fields_raw, fields_masked, cats, aud_mode, aud_cats, aud_orgs)
        values (${T}, ${org ? "sell" : "note"}, ${U}, 'Người đăng', ${org}, ${key}, ${key}, '', '', '{}'::jsonb, '{}'::jsonb, '{}', ${mode}, '{}',
          ${tx.array(orgs)}::uuid[])`;
    for (const m of ["all", "suppliers", "buyers", "cats"]) await base(`old_${m}`, null, m);
    await base("old_companies", null, "companies", [ORG]);
    await base("old_partner", ORG, null);
  });
}

beforeAll(async () => {
  await recreate(OLD_DB);
  await recreate(NEW_DB);
  // (A) trạng thái prod hiện tại: gói community dừng ở 0022
  const u = urlOf(OLD_DB);
  await runMigrations({ url: u, appEnv: "test" });
  await runHubMigrations({ url: u, appEnv: "test" });
  await applyDir(u, dbDir("migrations-packs"), PACKS_KIT_TABLE);
  await applyDir(u, dbDir("migrations-pack-contracts"), "__drizzle_migrations_pack_contracts");
  await applyDir(
    u,
    truncated("migrations-pack-community", 22),
    "__drizzle_migrations_pack_community",
  );
  oldDb = postgres(u, { max: 2, onnotice: () => {} });
  await seedOld(oldDb);
  // (B) từ đầu
  await migrateAll(urlOf(NEW_DB));
  newDb = postgres(urlOf(NEW_DB), { max: 4, onnotice: () => {} });
}, 900_000);

afterAll(async () => {
  await oldDb?.end();
  await newDb?.end();
  rmSync(tmpRoot, { recursive: true, force: true });
  for (const db of [OLD_DB, NEW_DB]) await recreate(db).catch(() => {});
});

const COL = (sql: postgres.Sql) =>
  sql`select udt_name, is_nullable, column_default from information_schema.columns
    where table_schema = 'community' and table_name = 'posts' and column_name = 'aud_tenants'`;

describe("CR-191 community 0025 · tiến từ bản hiện tại (≤ 0022 + bài cũ)", () => {
  test("trước migrate chưa có cột; sau migrate: bài cũ nguyên mức, aud_tenants rỗng, không mất bài; chạy lại 0 migration", async () => {
    expect((await COL(oldDb)).length).toBe(0);
    const before =
      await oldDb`select title_raw, aud_mode, aud_orgs::text[] as orgs from community.posts order by title_raw`;
    const r = await migrateAll(urlOf(OLD_DB));
    expect(r.packs.community).toBeGreaterThanOrEqual(1);
    const after =
      await oldDb`select title_raw, aud_mode, aud_orgs::text[] as orgs, aud_tenants::text[] as ten
      from community.posts order by title_raw`;
    expect(after.map((x) => [x.title_raw, x.aud_mode, x.orgs])).toEqual(
      before.map((x) => [x.title_raw, x.aud_mode, x.orgs]),
    );
    expect(after.length).toBe(6);
    expect(after.every((x) => x.ten.length === 0)).toBe(true);
    expect((await migrateAll(urlOf(OLD_DB))).packs.community).toBe(0);
  }, 300_000);
});

describe("CR-191 community 0025 · lược đồ (từ đầu)", () => {
  test("aud_tenants uuid[] NOT NULL mặc định rỗng", async () => {
    const [c] = await COL(newDb);
    expect([c?.udt_name, c?.is_nullable]).toEqual(["_uuid", "NO"]);
    expect(String(c?.column_default)).toContain("{}");
  });

  type Tx = postgres.TransactionSql;
  const ins = (
    sql: postgres.Sql | Tx,
    o: { org?: string | null; mode?: string | null; tenants?: number },
  ) =>
    sql`insert into community.posts (tenant_id, type, author_user_id, author_name, author_org, title_raw, title_masked, body_raw,
        body_masked, fields_raw, fields_masked, cats, aud_mode, aud_tenants)
      select ${T}, ${o.org ? "sell" : "note"}, ${U}, 'x', ${o.org ?? null}, 't', 't', '', '', '{}'::jsonb, '{}'::jsonb, '{}', ${o.mode ?? null},
        array(select gen_random_uuid() from generate_series(1, ${o.tenants ?? 0}))`;
  /** Mỗi ca một savepoint (lỗi không làm hỏng tx), cả tx rollback cuối ⇒ không để lại hàng. */
  async function cases(
    run: (tryIt: (o: Parameters<typeof ins>[1]) => Promise<string>) => Promise<void>,
  ): Promise<void> {
    class Rollback extends Error {}
    await newDb
      .begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        let n = 0;
        await run(async (o) => {
          const sp = `sp${n++}`;
          await tx.unsafe(`savepoint ${sp}`);
          try {
            await ins(tx, o);
            return "ok";
          } catch (e) {
            await tx.unsafe(`rollback to savepoint ${sp}`);
            return (e as { code?: string }).code ?? "err";
          }
        });
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  }

  test("CHECK: internal hợp lệ cho bài chủ quản; bài đối tác không có mode; mode lạ bị chặn; mọi mode cũ vẫn ok", async () => {
    const got: Record<string, string> = {};
    await cases(async (tryIt) => {
      for (const m of ["all", "internal", "suppliers", "buyers", "cats", "companies"])
        got[m] = await tryIt({ mode: m });
      got.partnerWithMode = await tryIt({ org: ORG, mode: "internal" });
      got.hostNoMode = await tryIt({ mode: null });
      got.unknown = await tryIt({ mode: "public" });
    });
    expect(got).toEqual({
      all: "ok",
      internal: "ok",
      suppliers: "ok",
      buyers: "ok",
      cats: "ok",
      companies: "ok",
      partnerWithMode: "23514",
      hostNoMode: "23514",
      unknown: "23514",
    });
  });

  test("CHECK: aud_tenants ≤ 200 (200 ok, 201 bị chặn)", async () => {
    const got: string[] = [];
    await cases(async (tryIt) => {
      got.push(await tryIt({ mode: "companies", tenants: 200 }));
      got.push(await tryIt({ mode: "companies", tenants: 201 }));
    });
    expect(got).toEqual(["ok", "23514"]);
  });

  test("SQL audience_ok khớp bảng chân trị cho mọi người xem là đối tác (nội bộ không qua hàm này)", async () => {
    const rows = TRUTH.filter((r) => r.viewer.kind === "partner");
    expect(rows.length).toBeGreaterThan(20);
    const uuid = (s: string) =>
      /^[0-9a-f-]{36}$/.test(s) ? s : "00000000-0000-4000-8000-00000000cc01";
    const payload = rows.map((r, i) => {
      const v = r.viewer as Extract<typeof r.viewer, { kind: "partner" }>;
      return {
        i,
        mode: r.aud.mode,
        cats: r.aud.cats,
        orgs: r.aud.companies,
        type: r.type,
        pcats: r.postCats,
        org: uuid(v.org),
        labels: v.labels,
        vcats: v.cats,
      };
    });
    const got =
      await newDb`select x.i as i, community.audience_ok(x.mode, x.cats, x.orgs, x.type, x.pcats, x.org, x.labels, x.vcats) as ok
      from jsonb_to_recordset(${newDb.json(payload)}) as x(i int, mode text, cats text[], orgs uuid[], type text, pcats text[], org uuid, labels text[], vcats text[])`;
    const sqlOk = new Map(got.map((g) => [Number(g.i), g.ok as boolean]));
    const bad = rows.filter((r, i) => sqlOk.get(i) !== r.want).map((r) => r.name);
    expect(bad).toEqual([]);
  });
});
