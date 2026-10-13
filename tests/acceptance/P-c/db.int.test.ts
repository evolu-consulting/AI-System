// HUB-FR-130 · HUB-BR-14 · PC-R12 · PC-R14 · P-c1 · plan §2 (migration 0031) · test-plan §3 D01–D08: bảng `hub.autofix_results`
// (CHECK có tên, UNIQUE job, RLS "T", GRANT append-only, không quyền agent_runtime) + nới `review_tasks_reason_ck`,
// `jobs_error_reason_check`. Đỏ trước code: chưa có `0031_*.sql` / bảng ⇒ đỏ ở expect đầu ca (không PostgresError ở beforeAll).
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
const file0031 = (): string | undefined => readdirSync(DIR).find((f) => /^0031_.*\.sql$/.test(f));
const A = { id: PA.A.id, tid: T.acme };
const D = { id: PA.Db.id, tid: T.beta };
let seq = 1000;
const U = (n: number) => `c0c10000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  ({ sql } = await setupPa());
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
  rt = postgres(AGENT_RT_URL, { max: 2, onnotice: () => {} });
  has = await tableExists(sql, "hub.autofix_results");
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
  expect({ table_hub_autofix_results: has }).toEqual({ table_hub_autofix_results: true });
const row = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  tenant_id: T.acme,
  process_run_id: run.runId,
  stage_run_id: run.stageRunIds[0] as string,
  job_id: U(seq++),
  round: 1,
  source_key: "app-repo",
  pin: { kind: "git_remote", url: "https://github.com/pc-test/app-repo.git", sha: "a".repeat(40) },
  branch: `ai/${run.runId}/doc`,
  base_sha: "1".repeat(40),
  head_sha: "2".repeat(40),
  status: "no_changes",
  ...o,
});
/** INSERT owner (bỏ RLS) — trả tên constraint vi phạm hoặc "ok". */
const insOwner = (o: Record<string, unknown> = {}): Promise<string> => {
  const r = row(o);
  return sql`insert into hub.autofix_results (tenant_id, process_run_id, stage_run_id, job_id, round, source_key, pin,
      branch, base_sha, head_sha, status, diff_attachment_id)
    values (${r.tenant_id as string}, ${r.process_run_id as string}, ${r.stage_run_id as string}, ${r.job_id as string},
      ${r.round as number}, ${r.source_key as string}, ${sql.json(r.pin as never)}, ${r.branch as string},
      ${r.base_sha as string}, ${r.head_sha as string}, ${r.status as string}, ${(r.diff_attachment_id as string) ?? null})`.then(
    () => "ok",
    (e: { constraint_name?: string; code?: string }) => e.constraint_name ?? e.code ?? "?",
  );
};

describe("D01 · migration 0031 [plan §2]", () => {
  it("HUB-FR-130 · D01 · có 0031_*.sql, chạy lại lần 2 không lỗi (idempotent); bảng hub.autofix_results có", async () => {
    const f = file0031();
    expect({ file0031: f !== undefined }).toEqual({ file0031: true });
    await sql.unsafe(readFileSync(join(DIR, f as string), "utf8"));
    await sql.unsafe(readFileSync(join(DIR, f as string), "utf8"));
    expect(await tableExists(sql, "hub.autofix_results")).toBe(true);
  });
});

describe("D02–D04 · CHECK [plan §2]", () => {
  it("HUB-FR-130 · PC-R12 · D02 · status ngoài enum ⇒ autofix_results_status_ck; status≠ok có diff ⇒ autofix_results_diff_ck; round 0 ⇒ round_ck", async () => {
    need();
    expect(await insOwner()).toBe("ok");
    expect(await insOwner({ status: "merged" })).toBe("autofix_results_status_ck");
    // CHECK chạy trước FK ⇒ id attachment không tồn tại vẫn báo đúng diff_ck
    expect(await insOwner({ status: "check_failed", diff_attachment_id: U(999) })).toBe(
      "autofix_results_diff_ck",
    );
    expect(await insOwner({ round: 0 })).toBe("autofix_results_round_ck");
  });
  it("HUB-FR-128 · E1 · D03 · branch_ck: `ai/<uuid>/<stage_key>` (STAGE_KEY_RE) nhận; `..`, hoa, không phải uuid, nhánh khác ⇒ lỗi", async () => {
    need();
    for (const k of ["fix", "a", "fix-2", "x".repeat(32)])
      expect(await insOwner({ branch: `ai/${run.runId}/${k}` })).toBe("ok");
    for (const b of [
      `ai/${run.runId}/../main`,
      "main",
      `ai/${run.runId}/Fix`,
      "ai/xyz/fix",
      `ai/${run.runId}/a/b`,
    ])
      expect(await insOwner({ branch: b })).toBe("autofix_results_branch_ck");
  });
  it("HUB-FR-130 · D04 · sha_ck (40 hex thường); UNIQUE job_id ⇒ 23505 / autofix_results_job_uq", async () => {
    need();
    expect(await insOwner({ base_sha: "HEAD" })).toBe("autofix_results_sha_ck");
    expect(await insOwner({ job_id: U(77) })).toBe("ok");
    expect(await insOwner({ job_id: U(77) })).toBe("autofix_results_job_uq");
  });
});

describe("D05–D08 · RLS + GRANT + CHECK nới [PC-R14, HUB-BR-14]", () => {
  it("HUB-BR-14 · PC-R14 · D05 · hub_rw GUC acme thấy hàng acme; GUC beta 0 hàng; INSERT tenant beta dưới GUC acme ⇒ lỗi", async () => {
    need();
    expect(await insOwner({ job_id: U(501) })).toBe("ok");
    const seenA = await asUser(
      db,
      A,
      (tx) => tx`select job_id from hub.autofix_results where job_id = ${U(501)}`,
    );
    const seenB = await asUser(
      db,
      D,
      (tx) => tx`select job_id from hub.autofix_results where job_id = ${U(501)}`,
    );
    expect({ acme: seenA.length, beta: seenB.length }).toEqual({ acme: 1, beta: 0 });
    const r = row({ tenant_id: T.beta, job_id: U(502) });
    const cross = await pgCode(
      asUser(
        db,
        A,
        (
          tx,
        ) => tx`insert into hub.autofix_results (tenant_id, process_run_id, stage_run_id, job_id, round, source_key, pin,
          branch, base_sha, head_sha, status) values (${T.beta}, ${run.runId}, ${r.stage_run_id as string}, ${U(502)}, 1,
          'app-repo', ${tx.json({ kind: "git_remote" })}, ${r.branch as string}, ${"1".repeat(40)}, ${"2".repeat(40)}, 'no_changes')`,
      ),
    );
    expect(cross).not.toBe("ok");
  });
  it("HUB-FR-130 · PC-R12 · D06 · append-only: hub_rw INSERT được, UPDATE/DELETE ⇒ 42501", async () => {
    need();
    const r = row({ job_id: U(601) });
    const ins = (tx: postgres.TransactionSql) =>
      tx`insert into hub.autofix_results (tenant_id, process_run_id, stage_run_id, job_id, round, source_key, pin, branch,
        base_sha, head_sha, status) values (${T.acme}, ${run.runId}, ${r.stage_run_id as string}, ${U(601)}, 1, 'app-repo',
        ${tx.json(r.pin as never)}, ${r.branch as string}, ${"1".repeat(40)}, ${"2".repeat(40)}, 'no_changes')`;
    expect(await pgCode(asUser(db, A, async (tx) => void (await ins(tx))))).toBe("ok");
    const upd = asUser(db, A, async (tx) => {
      await ins(tx);
      await tx`update hub.autofix_results set status = 'ok'`;
    });
    const del = asUser(db, A, async (tx) => {
      await ins(tx);
      await tx`delete from hub.autofix_results`;
    });
    expect([await pgCode(upd), await pgCode(del)]).toEqual(["42501", "42501"]);
  });
  it("HUB-BR-33 · D07 · agent_runtime không quyền đọc/ghi hub.autofix_results (42501)", async () => {
    need();
    expect(await pgCode(rt`select 1 from hub.autofix_results limit 1`)).toBe("42501");
  });
  it("HUB-FR-115 · D08 · CHECK nới: review_tasks reason autofix_check_failed/sandbox_unavailable + jobs error_reason container được nhận (constraint có định nghĩa chứa giá trị)", async () => {
    const defOf = async (name: string) =>
      (
        await sql<
          { d: string }[]
        >`select pg_get_constraintdef(oid) as d from pg_constraint where conname = ${name}`
      )[0]?.d ?? "";
    const rt1 = await defOf("review_tasks_reason_ck");
    const jb = await defOf("jobs_error_reason_check");
    expect({
      check_failed: rt1.includes("autofix_check_failed"),
      sandbox: rt1.includes("sandbox_unavailable"),
      back_limit_kept: rt1.includes("back_limit"),
      container: jb.includes("'container'"),
      upstream_kept: jb.includes("'upstream'"),
    }).toEqual({
      check_failed: true,
      sandbox: true,
      back_limit_kept: true,
      container: true,
      upstream_kept: true,
    });
  });
});
