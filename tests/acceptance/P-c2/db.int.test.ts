// HUB-FR-130 · HUB-FR-129 · HUB-BR-14 · PC2-R13 · PC2-R16 · P-c2 · plan §2 (migration 0032) · test-plan P-c2 §4 D01–D08: bảng
// `hub.autofix_applies` (CHECK có tên, UNIQUE job, FK, RLS "T", GRANT SELECT/INSERT + UPDATE theo cột, không agent_runtime) + nới
// `review_tasks_reason_ck`, `jobs_type_ck`, `jobs_agent_ck` (job `source.apply` không agent — G3). Đỏ trước code: chưa có
// `0032_*.sql`/bảng ⇒ đỏ ở expect đầu ca (không PostgresError ở beforeAll).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { AGENT_RT_URL, HUB_API_URL } from "../H1/_fixtures";
import { ROOT } from "../P-a/_support/modules";
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
} from "../P-a/_support/pa";
import { tableExists } from "../P-a/_support/schema";
import { asUser, pgCode } from "../X2a/_x2a";

let sql: Sql;
let db: Sql;
let rt: Sql;
let has = false;
let run: RunFix;
const DIR = join(ROOT, "packages/db/migrations-hub");
const file0032 = (): string | undefined => readdirSync(DIR).find((f) => /^0032_.*\.sql$/.test(f));
const A = { id: PA.A.id, tid: T.acme };
const D = { id: PA.Db.id, tid: T.beta };
let seq = 1000;
const U = (n: number) => `c2c30000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S40 = (ch: string) => ch.repeat(40);

beforeAll(async () => {
  ({ sql } = await setupPa());
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
  rt = postgres(AGENT_RT_URL, { max: 2, onnotice: () => {} });
  has = await tableExists(sql, "hub.autofix_applies");
  await insertDef(sql, { id: PA_FIX.defHoaDon, tenantId: T.acme });
  run = await insertRun(sql, {
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

const need = () =>
  expect({ table_hub_autofix_applies: has }).toEqual({ table_hub_autofix_applies: true });
type Row = Record<string, string | number | boolean | null | unknown[]>;
const row = (o: Row = {}): Row => ({
  tenant_id: T.acme,
  process_run_id: run.runId,
  stage_run_id: run.stageRunIds[0] as string,
  job_id: U(seq++),
  source_key: "app-repo",
  mode: "pr",
  status: "no_changes",
  branch: `ai/${run.runId}/fix`,
  pin_sha: S40("a"),
  target_sha: null,
  head_sha: null,
  provider: null,
  pr_number: null,
  pr_url: null,
  auto_merge: null,
  error_code: null,
  detail: null,
  conflict_files: [],
  ...o,
});
const ins = (tx: postgres.Sql | postgres.TransactionSql, r: Row) =>
  tx`insert into hub.autofix_applies (tenant_id, process_run_id, stage_run_id, job_id, source_key, mode, status, branch,
      pin_sha, target_sha, head_sha, provider, pr_number, pr_url, auto_merge, error_code, detail, conflict_files)
    values (${r.tenant_id as string}, ${r.process_run_id as string}, ${r.stage_run_id as string}, ${r.job_id as string | null},
      ${r.source_key as string}, ${r.mode as string}, ${r.status as string}, ${r.branch as string | null},
      ${r.pin_sha as string | null}, ${r.target_sha as string | null}, ${r.head_sha as string | null},
      ${r.provider as string | null}, ${r.pr_number as number | null}, ${r.pr_url as string | null},
      ${r.auto_merge as string | null}, ${r.error_code as string | null}, ${r.detail as string | null},
      ${tx.json(r.conflict_files as never)})`;
/** INSERT owner (bỏ RLS) — trả tên constraint vi phạm hoặc "ok". */
const insOwner = (o: Row = {}): Promise<string> =>
  ins(sql, row(o)).then(
    () => "ok",
    (e: { constraint_name?: string; code?: string }) => e.constraint_name ?? e.code ?? "?",
  );

describe("D01 · migration 0032 [plan §2]", () => {
  it("HUB-FR-130 · D01 · có 0032_*.sql, chạy lại lần 2 không lỗi (idempotent); bảng hub.autofix_applies có", async () => {
    const f = file0032();
    expect({ file0032: f !== undefined }).toEqual({ file0032: true });
    await sql.unsafe(readFileSync(join(DIR, f as string), "utf8"));
    await sql.unsafe(readFileSync(join(DIR, f as string), "utf8"));
    expect(await tableExists(sql, "hub.autofix_applies")).toBe(true);
  });
});

describe("D02–D04 · CHECK có tên [plan §2]", () => {
  it("HUB-FR-130 · D02 · enum: status/mode/provider/auto_merge/error_code ngoài danh sách ⇒ đúng constraint", async () => {
    need();
    expect(await insOwner()).toBe("ok");
    expect(await insOwner({ status: "merged" })).toBe("autofix_applies_status_ck");
    expect(await insOwner({ mode: "push" })).toBe("autofix_applies_mode_ck");
    expect(await insOwner({ provider: "gitlab" })).toBe("autofix_applies_provider_ck");
    expect(await insOwner({ auto_merge: "maybe" })).toBe("autofix_applies_auto_ck");
    expect(await insOwner({ status: "failed", error_code: "boom" })).toBe("autofix_applies_err_ck");
  });
  it("HUB-FR-129 · C11 · D03 · bất biến: failed/check_failed thiếu error_code ⇒ err_req_ck; conflict không mã ⇒ ok; pushed/pr_opened thiếu head ⇒ pushed_ck; pr_opened thiếu số PR ⇒ pr_ck", async () => {
    need();
    expect(await insOwner({ status: "failed" })).toBe("autofix_applies_err_req_ck");
    expect(await insOwner({ status: "check_failed" })).toBe("autofix_applies_err_req_ck");
    expect(await insOwner({ status: "check_failed", error_code: "check_failed" })).toBe("ok");
    expect(await insOwner({ status: "conflict", conflict_files: ["src/a.ts"] })).toBe("ok");
    expect(await insOwner({ status: "pushed" })).toBe("autofix_applies_pushed_ck");
    expect(await insOwner({ status: "pushed", head_sha: S40("b"), target_sha: S40("a") })).toBe(
      "ok",
    );
    expect(await insOwner({ status: "pr_opened", head_sha: S40("b"), provider: "github" })).toBe(
      "autofix_applies_pr_ck",
    );
    expect(
      await insOwner({
        status: "pr_opened",
        head_sha: S40("b"),
        provider: "github",
        pr_number: 7,
        pr_url: "https://github.com/a/b/pull/7",
      }),
    ).toBe("ok");
  });
  it("HUB-FR-128 · PC2-R06 · PC2-R15 · D04 · sha/branch/url/detail/json CHECK; UNIQUE job_id (null lặp được)", async () => {
    need();
    expect(await insOwner({ pin_sha: "HEAD" })).toBe("autofix_applies_sha_ck");
    expect(await insOwner({ target_sha: S40("A") })).toBe("autofix_applies_sha_ck");
    for (const b of [
      "main",
      `ai/${run.runId}/Fix`,
      "ai/xyz/fix",
      `ai/${run.runId}/a/b`,
      `ai/${run.runId}/${"x".repeat(33)}`,
    ])
      expect({ b, r: await insOwner({ branch: b }) }).toEqual({
        b,
        r: "autofix_applies_branch_ck",
      });
    expect(await insOwner({ branch: null, status: "branch_only" })).toBe("ok");
    expect(await insOwner({ pr_url: "http://github.com/a/b/pull/1" })).toBe(
      "autofix_applies_url_ck",
    );
    expect(await insOwner({ pr_url: `https://github.com/${"a".repeat(2050)}` })).toBe(
      "autofix_applies_url_ck",
    );
    expect(await insOwner({ detail: "x".repeat(301) })).toBe("autofix_applies_detail_ck");
    expect(await insOwner({ conflict_files: { a: 1 } as never })).toBe("autofix_applies_json_ck");
    expect(await insOwner({ job_id: U(77) })).toBe("ok");
    expect(await insOwner({ job_id: U(77) })).toBe("autofix_applies_job_uq");
    expect([await insOwner({ job_id: null }), await insOwner({ job_id: null })]).toEqual([
      "ok",
      "ok",
    ]);
  });
});

describe("D05–D08 · RLS + GRANT theo cột + CHECK nới [PC2-R16, PC2-R13]", () => {
  it("HUB-BR-14 · PC2-R16 · D05 · hub_rw GUC acme thấy hàng acme; GUC beta 0 hàng; INSERT tenant beta dưới GUC acme ⇒ lỗi", async () => {
    need();
    expect(await insOwner({ job_id: U(501) })).toBe("ok");
    const q = (tx: postgres.TransactionSql) =>
      tx`select job_id from hub.autofix_applies where job_id = ${U(501)}`;
    const [seenA, seenB] = [await asUser(db, A, q), await asUser(db, D, q)];
    expect({ acme: seenA.length, beta: seenB.length }).toEqual({ acme: 1, beta: 0 });
    const cross = await pgCode(
      asUser(db, A, async (tx) => void (await ins(tx, row({ tenant_id: T.beta })))),
    );
    expect(cross).not.toBe("ok");
  });
  it("HUB-FR-130 · PC2-R13 · C6 · D06 · hub_rw: INSERT + UPDATE (status, provider, pr_number, pr_url, auto_merge, error_code, detail, updated_at) được; UPDATE cột khác / DELETE ⇒ 42501", async () => {
    need();
    const id = U(601);
    expect(
      await pgCode(
        asUser(
          db,
          A,
          async (tx) =>
            void (await ins(tx, row({ job_id: id, status: "pushed", head_sha: S40("b") }))),
        ),
      ),
    ).toBe("ok");
    const okUpd = asUser(db, A, async (tx) => {
      await tx`update hub.autofix_applies set status = 'pr_opened', provider = 'github', pr_number = 9,
        pr_url = 'https://github.com/a/b/pull/9', auto_merge = 'on', error_code = null, detail = null, updated_at = now()
        where job_id = ${id}`;
    });
    expect(await pgCode(okUpd)).toBe("ok");
    const bad = async (stmt: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      pgCode(asUser(db, A, stmt));
    expect([
      await bad(
        (tx) =>
          tx`update hub.autofix_applies set branch = ${`ai/${run.runId}/x`} where job_id = ${id}`,
      ),
      await bad(
        (tx) => tx`update hub.autofix_applies set head_sha = ${S40("c")} where job_id = ${id}`,
      ),
      await bad(
        (tx) => tx`update hub.autofix_applies set mode = 'branch_only' where job_id = ${id}`,
      ),
      await bad((tx) => tx`delete from hub.autofix_applies where job_id = ${id}`),
    ]).toEqual(["42501", "42501", "42501", "42501"]);
  });
  it("HUB-BR-33 · D07 · agent_runtime không quyền đọc/ghi hub.autofix_applies (42501)", async () => {
    need();
    expect(await pgCode(rt`select 1 from hub.autofix_applies limit 1`)).toBe("42501");
  });
  it("HUB-FR-115 · HUB-FR-129 · D08 · CHECK nới: review_tasks reason += apply_conflict, apply_failed (giữ sandbox_unavailable); jobs_type_ck += source.apply (giữ source.resolve); jobs_agent_ck cho source.apply không agent", async () => {
    const defOf = async (name: string) =>
      (
        await sql<
          { d: string }[]
        >`select pg_get_constraintdef(oid) as d from pg_constraint where conname = ${name}`
      )[0]?.d ?? "";
    const [rv, ty, ag] = [
      await defOf("review_tasks_reason_ck"),
      await defOf("jobs_type_ck"),
      await defOf("jobs_agent_ck"),
    ];
    expect({
      conflict: rv.includes("apply_conflict"),
      failed: rv.includes("apply_failed"),
      sandbox_kept: rv.includes("sandbox_unavailable"),
      apply_type: ty.includes("'source.apply'"),
      resolve_kept: ty.includes("'source.resolve'"),
      apply_no_agent: ag.includes("'source.apply'"),
    }).toEqual({
      conflict: true,
      failed: true,
      sandbox_kept: true,
      apply_type: true,
      resolve_kept: true,
      apply_no_agent: true,
    });
  });
});
