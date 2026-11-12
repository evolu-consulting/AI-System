// CR-127 · Z3/Z4 · thứ tự migrate.ts (main → hub → gói): hub 0135/0136 chạy TRƯỚC gói contracts nên KHÔNG được dùng `contracts.effect_of`/`effect`
// (chỉ có từ gói 0091). DB staging/prod đang ở gói < 0091 + hub ≤ 0134 + quy trình cũ/mẫu `hd-*` còn lượt mở + HĐ đang duyệt ⇒ chạy đúng thứ tự
// `migrate.ts` không lỗi; HĐ về draft (+ event), lượt `contracts.approvals` đóng, lượt engine huỷ; HĐ của quy trình mới nguyên; chạy lại vô hại.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { HUB_TABLE, runHubMigrations, withMigrateLock } from "./migrate-hub";
import { PACKS_KIT_TABLE, runPackMigrations } from "./migrate-packs";
import { withDatabase } from "./test-db";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const DB_NAME = "ai_system_cr127mig_test";
const URL = withDatabase(BASE, DB_NAME);
const dbDir = (name: string) => fileURLToPath(new globalThis.URL(`../${name}`, import.meta.url));
const tmpRoot = mkdtempSync(join(tmpdir(), "cr127-order-"));

let owner: postgres.Sql;

/** Bản sao thư mục migration, journal chỉ giữ các migration có số ≤ `maxNo` (trạng thái "DB đang ở bản cũ"). */
function truncated(name: string, maxNo: number): string {
  const dest = join(tmpRoot, name);
  cpSync(dbDir(name), dest, { recursive: true });
  const jf = join(dest, "meta", "_journal.json");
  const j = JSON.parse(readFileSync(jf, "utf8")) as { entries: { tag: string }[] };
  j.entries = j.entries.filter((e) => Number.parseInt(e.tag.slice(0, 4), 10) <= maxNo);
  writeFileSync(jf, JSON.stringify(j));
  return dest;
}
async function applyDir(folder: string, table: string): Promise<void> {
  const sql = postgres(URL, { max: 1, onnotice: () => {} });
  try {
    await withMigrateLock(URL, () =>
      migrate(drizzle(sql), { migrationsFolder: folder, migrationsTable: table }),
    );
  } finally {
    await sql.end();
  }
}
/** Đúng thứ tự `migrate.ts`: main → hub → gói. */
async function migrateAll(): Promise<void> {
  await runMigrations({ url: URL, appEnv: "test" });
  await runHubMigrations({ url: URL, appEnv: "test" });
  await runPackMigrations({ url: URL, appEnv: "test" });
}

const id = (n: number) => `01900000-0000-7000-8000-00000127d5${String(n).padStart(2, "0")}`;
const TA = id(1);
const U = id(3);
const [DEF_OLD, DEF_TPL, DEF_NEW] = [10, 11, 12].map(id) as [string, string, string];
const [RUN_OLD, RUN_TPL, RUN_NEW] = [20, 21, 22].map(id) as [string, string, string];
const [C_OLD, C_TPL, C_NEW] = [30, 31, 32].map(id) as [string, string, string];
const [AP_OLD, AP_TPL, AP_NEW] = [40, 41, 42].map(id) as [string, string, string];
const STAGE_TOOL = [{ key: "route", executor: { kind: "tool", tool_key: "contracts-route" } }];
const STAGE_OK = [{ key: "a", executor: { kind: "approve" } }];

beforeAll(async () => {
  const m = postgres(withDatabase(BASE, "postgres"), { max: 1, onnotice: () => {} });
  try {
    await m.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    await m.unsafe(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await m.end();
  }
  // Trạng thái staging/prod trước deploy: main đủ, hub ≤ 0134, bộ khung gói đủ, gói contracts ≤ 0090.
  await runMigrations({ url: URL, appEnv: "test" });
  await applyDir(truncated("migrations-hub", 134), HUB_TABLE);
  await applyDir(dbDir("migrations-packs"), PACKS_KIT_TABLE);
  await applyDir(truncated("migrations-pack-contracts", 90), "__drizzle_migrations_pack_contracts");
  owner = postgres(URL, { max: 2, onnotice: () => {} });
  const [pre] =
    await owner`select to_regprocedure('contracts.effect_of(text,timestamptz,text,date,date,jsonb,date)') as f`;
  expect(pre?.f ?? null).toBeNull(); // gói thật sự < 0091 (chưa có effect_of)
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const def = async (d: string, key: string, stages: unknown) => {
      await tx`insert into hub.process_defs (id, tenant_id, key, name, stages, enabled, published_version, slot)
        values (${d}, null, ${key}, ${key}, ${tx.json(stages as never)}, true, 1, 'contracts.approval')`;
      await tx`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${d}, 1, ${key}, ${tx.json(stages as never)})`;
    };
    await def(DEF_OLD, "cr127-ord-old", STAGE_TOOL);
    await def(DEF_TPL, "hd-sap-het-han", STAGE_OK); // mẫu Thư viện bị gỡ (0136)
    await def(DEF_NEW, "cr127-ord-new", STAGE_OK); // quy trình mới: không đụng
    for (const [run, d, c, st] of [
      [RUN_OLD, DEF_OLD, C_OLD, "needs_decision"],
      [RUN_TPL, DEF_TPL, C_TPL, "waiting_review"],
      [RUN_NEW, DEF_NEW, C_NEW, "waiting_review"],
    ] as const) {
      await tx`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
          conversation_id, flow_id, status, pack_key, pack_record_id)
        values (${run}, ${TA}, ${d}, 1, '{}'::jsonb, ${U}, 'admin', '', ${run}, ${run}, ${st}, 'contracts', ${c})`;
    }
    for (const [c, ap, run] of [
      [C_OLD, AP_OLD, RUN_OLD],
      [C_TPL, AP_TPL, RUN_TPL],
      [C_NEW, AP_NEW, RUN_NEW],
    ] as const) {
      // Trước 0091: HĐ đang duyệt = `needs_review` + trỏ lượt `approvals` sống (0091 backfill ⇒ `processing`).
      await tx`insert into contracts.contracts (id, tenant_id, root_id, kind, title, direction, status, owner_user_id, created_by, version, fields, run_id)
        values (${c}, ${TA}, ${c}, 'contract', 'ord', 'purchase', 'needs_review', ${U}, ${U}, 1, '{}'::jsonb, ${ap})`;
      await tx`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, engine_run_id)
        values (${ap}, ${TA}, ${c}, 'level2', ${U}, 'engine', ${run})`;
    }
  });
}, 600_000);

afterAll(async () => {
  await owner?.end();
  rmSync(tmpRoot, { recursive: true, force: true });
  const m = postgres(withDatabase(BASE, "postgres"), { max: 1, onnotice: () => {} });
  try {
    await m.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  } finally {
    await m.end();
  }
});

describe("CR-127 Z3/Z4 · migrate đúng thứ tự trên DB gói < 0091 (int)", () => {
  test("hub 0135/0136 không lỗi; HĐ về draft + event; lượt approvals đóng; lượt engine huỷ; HĐ quy trình mới nguyên", async () => {
    await migrateAll();
    const cs =
      await owner`select id::text, status from contracts.contracts where id in (${C_OLD}, ${C_TPL}, ${C_NEW})`;
    const st = Object.fromEntries(cs.map((c) => [c.id, c.status]));
    expect(st[C_OLD]).toBe("draft");
    expect(st[C_TPL]).toBe("draft");
    expect(st[C_NEW]).toBe("processing");
    const ap =
      await owner`select id::text, status from contracts.approvals where id in (${AP_OLD}, ${AP_TPL}, ${AP_NEW})`;
    const apBy = Object.fromEntries(ap.map((a) => [a.id, a.status]));
    expect(apBy[AP_OLD]).toBe("cancelled");
    expect(apBy[AP_TPL]).toBe("cancelled");
    expect(apBy[AP_NEW]).toBe("level2");
    const runs =
      await owner`select id::text, status, decision->>'reason' as reason from hub.process_runs where id in (${RUN_OLD}, ${RUN_TPL}, ${RUN_NEW})`;
    const rb = Object.fromEntries(runs.map((r) => [r.id, r]));
    expect(rb[RUN_OLD]).toMatchObject({ status: "cancelled", reason: "legacy_flow_removed" });
    expect(rb[RUN_TPL]).toMatchObject({ status: "cancelled", reason: "template_removed" });
    expect(rb[RUN_NEW]?.status).toBe("waiting_review");
    const ev = await owner`select contract_id::text as c, data->>'code' as code, data->>'ev' as ev
      from contracts.contract_events where type = 'status_changed' and data->>'ev' = 'flow_cancelled'
        and contract_id in (${C_OLD}, ${C_TPL}, ${C_NEW}) order by contract_id`;
    expect([...ev]).toEqual([
      { c: C_OLD, code: "legacy_flow_removed", ev: "flow_cancelled" },
      { c: C_TPL, code: "template_removed", ev: "flow_cancelled" },
    ]);
    const [d] =
      await owner`select count(*)::int as n from hub.process_defs where id in (${DEF_OLD}, ${DEF_TPL}) and deleted_at is not null and not enabled`;
    expect(d?.n).toBe(2);
  }, 600_000);

  test("chạy lại cả ba bước vô hại: không thêm event, version không tăng", async () => {
    const [before] = await owner`select version from contracts.contracts where id = ${C_OLD}`;
    await migrateAll();
    const [after] =
      await owner`select status, version from contracts.contracts where id = ${C_OLD}`;
    expect(after).toMatchObject({ status: "draft", version: before?.version });
    const ev =
      await owner`select 1 from contracts.contract_events where contract_id = ${C_OLD} and data->>'ev' = 'flow_cancelled'`;
    expect(ev.length).toBe(1);
  });
});
