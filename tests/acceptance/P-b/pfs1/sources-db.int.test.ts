// P-b · PF-S1 · PB-R20 · D-01…D-09 (test-plan §4.1): migration 0021 (idempotent), RLS `hub.sources`/`source_job_reads`, GRANT,
// CHECK có tên, unique xoá mềm, cột mới nullable, `jobs_type_ck`/`review_tasks_reason_ck`, FK composite.
// Đỏ trước code: chưa có `0021_*.sql` / bảng `hub.sources` ⇒ ca đỏ ở `expect(…).toBe(true)` đầu ca (không PostgresError).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { AGENT_RT_URL, HUB_API_URL } from "../../H1/_fixtures";
import { ROOT } from "../../P-a/_support/modules";
import {
  DEF_HD,
  insertDef,
  insertRun,
  PA,
  PA_FIX,
  type RunFix,
  type Sql,
  setupPa,
  T,
} from "../../P-a/_support/pa";
import { tableExists } from "../../P-a/_support/schema";
import { asUser, pgCode } from "../../X2a/_x2a";

let sql: Sql;
let db: Sql;
let rt: Sql;
let has = false;
let runA: RunFix;
const DIR = join(ROOT, "packages/db/migrations-hub");
const file0021 = (): string | undefined => readdirSync(DIR).find((f) => /^0021_.*\.sql$/.test(f));
const A = { id: PA.A.id, tid: T.acme };
const U = (n: number) => `b1b20000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  ({ sql } = await setupPa());
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
  rt = postgres(AGENT_RT_URL, { max: 2, onnotice: () => {} });
  has = await tableExists(sql, "hub.sources");
  if (!has) return;
  await insertDef(sql, { id: PA_FIX.defHoaDon, tenantId: T.acme });
  runA = await insertRun(sql, {
    def: DEF_HD(PA_FIX.defHoaDon),
    startedBy: PA.A,
    roomId: PA_FIX.room,
  });
}, 60_000);
afterAll(async () => {
  await db?.end();
  await rt?.end();
  await sql?.end();
});

const need = () => expect({ table_hub_sources: has }).toEqual({ table_hub_sources: true });
const ins = (tid: string, key: string, over: Record<string, unknown> = {}) => {
  const r = {
    tenant_id: tid,
    key,
    kind: "git_remote",
    config: { kind: "git_remote", url: "https://github.com/pb-test/app-repo.git", branch: "main" },
    description: "d",
    version: 1,
    ...over,
  };
  return sql`insert into hub.sources (tenant_id, key, kind, config, description, version)
    values (${r.tenant_id as string}, ${r.key as string}, ${r.kind as string}, ${sql.json(r.config as never)},
      ${r.description as string}, ${r.version as number})`;
};
const constraintOf = async (q: Promise<unknown>): Promise<string> =>
  q.then(
    () => "ok",
    (e: { constraint_name?: string; code?: string }) => e.constraint_name ?? e.code ?? "?",
  );

describe("D-01 · migration 0021 [PB-R20]", () => {
  it("PB-R20 · D-01 · có 0021_*.sql, chạy lại lần 2 không lỗi; bảng sources + source_job_reads tồn tại", async () => {
    const f = file0021();
    expect({ file0021: f !== undefined }).toEqual({ file0021: true });
    await sql.unsafe(readFileSync(join(DIR, f as string), "utf8"));
    await sql.unsafe(readFileSync(join(DIR, f as string), "utf8"));
    expect(await tableExists(sql, "hub.sources")).toBe(true);
    expect(await tableExists(sql, "hub.source_job_reads")).toBe(true);
  });
});

describe("D-02…D-04 · RLS + GRANT [PB-R20, HUB-BR-14]", () => {
  it("PB-R20 · D-02 · GUC acme chỉ thấy acme; INSERT tenant beta dưới GUC acme ⇒ lỗi; không GUC ⇒ 0 hàng", async () => {
    need();
    await ins(T.acme, "rls-acme");
    await ins(T.beta, "rls-beta");
    const seen = await asUser(db, A, (tx) => tx`select tenant_id from hub.sources`);
    expect(new Set(seen.map((r) => r.tenant_id))).toEqual(new Set([T.acme]));
    const cross = await pgCode(
      asUser(
        db,
        A,
        (tx) => tx`insert into hub.sources (tenant_id, key, kind, config)
        values (${T.beta}, 'x-beta', 'git_remote', ${tx.json({ kind: "git_remote", url: "https://github.com/a/b", branch: "m" })})`,
      ),
    );
    expect(cross).not.toBe("ok");
    const none = await asUser(db, null, (tx) => tx`select id from hub.sources`);
    expect(none.length).toBe(0);
  });

  it("PB-R20 · D-03 · source_job_reads: hub_rw INSERT/SELECT được, UPDATE/DELETE ⇒ permission denied (42501)", async () => {
    need();
    const [s] = await sql<{ id: string }[]>`select id from hub.sources where key = 'rls-acme'`;
    const stage = runA.stageRunIds[0] as string;
    const row = (tx: postgres.TransactionSql) =>
      tx`insert into hub.source_job_reads (tenant_id, process_run_id, stage_run_id, job_id, source_id, source_key, pin)
        values (${T.acme}, ${runA.runId}, ${stage}, ${U(1)}, ${s?.id as string}, 'rls-acme', ${tx.json({ kind: "git_remote" })})`;
    expect(
      await pgCode(
        asUser(db, A, async (tx) => {
          await row(tx);
        }),
      ),
    ).toBe("ok");
    expect(
      await pgCode(
        asUser(db, A, async (tx) => {
          await row(tx);
          await tx`update hub.source_job_reads set source_key = 'zz'`;
        }),
      ),
    ).toBe("42501");
    expect(
      await pgCode(
        asUser(db, A, async (tx) => {
          await row(tx);
          await tx`delete from hub.source_job_reads`;
        }),
      ),
    ).toBe("42501");
  });

  it("PB-R20 · D-04 · agent_runtime SELECT sources / source_job_reads ⇒ permission denied", async () => {
    need();
    expect(await pgCode(rt`select 1 from hub.sources limit 1`)).toBe("42501");
    expect(await pgCode(rt`select 1 from hub.source_job_reads limit 1`)).toBe("42501");
  });
});

describe("D-05…D-06 · CHECK + unique [PB-R01, PB-R20]", () => {
  it("PB-R01 · D-05 · vi phạm CHECK ⇒ đúng tên constraint", async () => {
    need();
    expect(await constraintOf(ins(T.acme, "A_bad"))).toBe("sources_key_ck");
    expect(await constraintOf(ins(T.acme, "ok-kind", { kind: "svn" }))).toBe("sources_kind_ck");
    expect(await constraintOf(ins(T.acme, "ok-cfg", { config: [] }))).toBe("sources_config_ck");
    expect(await constraintOf(ins(T.acme, "ok-desc", { description: "x".repeat(501) }))).toBe(
      "sources_desc_ck",
    );
    expect(await constraintOf(ins(T.acme, "ok-ver", { version: 0 }))).toBe("sources_version_ck");
  });

  it("PB-R20 · D-06 · unique (tenant,key) hoạt động; sau deleted_at chèn lại được; tenant khác cùng key được", async () => {
    need();
    await ins(T.acme, "uq-key");
    expect(await pgCode(ins(T.acme, "uq-key"))).toBe("23505");
    await ins(T.beta, "uq-key");
    await sql`update hub.sources set deleted_at = now() where tenant_id = ${T.acme} and key = 'uq-key'`;
    expect(await pgCode(ins(T.acme, "uq-key"))).toBe("ok");
  });
});

describe("D-07…D-09 · cột mới + CHECK mở rộng + FK [PB-R20]", () => {
  it("PB-R20 · D-07 · pinned_sources NULL ok, '[]' ok, '{}' ⇒ CHECK; process_defs.sources/inputs tương tự", async () => {
    need();
    const run = (v: unknown) =>
      pgCode(
        sql`update hub.process_runs set pinned_sources = ${v === null ? null : sql.json(v as never)} where id = ${runA.runId}`,
      );
    expect(await run(null)).toBe("ok");
    expect(await run([])).toBe("ok");
    expect(await run({})).toBe("23514");
    for (const col of ["sources", "inputs"]) {
      const upd = (v: unknown) =>
        pgCode(
          sql.unsafe(
            `update hub.process_defs set ${col} = $1::jsonb where id = '${PA_FIX.defHoaDon}'`,
            [JSON.stringify(v)],
          ),
        );
      expect([col, await upd([])]).toEqual([col, "ok"]);
      expect([col, await upd({})]).toEqual([col, "23514"]);
    }
  });

  it("PB-R20 · D-08 · jobs_type_ck nhận source.resolve, từ chối foo; review_tasks_reason_ck nhận source_unresolvable; hàng P-a nguyên vẹn", async () => {
    need();
    const def = pg_get_def("jobs_type_ck");
    expect(String(await def)).toContain("source.resolve");
    expect(String(await pg_get_def("review_tasks_reason_ck"))).toContain("source_unresolvable");
    expect(String(await pg_get_def("jobs_type_ck"))).not.toContain("foo");
    const [d] = await sql<
      { n: number }[]
    >`select count(*)::int as n from hub.process_defs where id = ${PA_FIX.defHoaDon}`;
    expect(d?.n).toBe(1);
  });

  it("PB-R20 · D-09 · FK composite source_job_reads→process_runs CASCADE; tenant lệch ⇒ lỗi FK", async () => {
    need();
    const [s] = await sql<{ id: string }[]>`select id from hub.sources where key = 'rls-acme'`;
    const stage = runA.stageRunIds[0] as string;
    const mk = (
      tid: string,
    ) => sql`insert into hub.source_job_reads (tenant_id, process_run_id, stage_run_id, job_id,
      source_id, source_key, pin) values (${tid}, ${runA.runId}, ${stage}, ${U(2)}, ${s?.id as string}, 'rls-acme',
      ${sql.json({ kind: "git_remote" })})`;
    expect(await pgCode(mk(T.beta))).toBe("23503");
    expect(await pgCode(mk(T.acme))).toBe("ok");
    await sql`delete from hub.process_runs where id = ${runA.runId}`;
    const [r] = await sql<
      { n: number }[]
    >`select count(*)::int as n from hub.source_job_reads where job_id = ${U(2)}`;
    expect(r?.n).toBe(0);
  });
});

async function pg_get_def(name: string): Promise<string> {
  const [r] = await sql<
    { d: string }[]
  >`select pg_get_constraintdef(oid) as d from pg_constraint where conname = ${name}`;
  return r?.d ?? "";
}
