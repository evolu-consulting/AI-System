// HUB-FR-128 · HUB-FR-130 · PC-R12 · migration 0031_pc_autofix (spec P-c §4, plan §2): Drizzle `autofixResults` ghi/đọc
// bằng `hub_api` (RLS user scope, jsonb khứ hồi, default `failures/commands`), append-only qua Drizzle (42501), FK attachment
// SET NULL + run CASCADE, index đủ 4, chạy lại 0031 hai lần không đổi ràng buộc/quyền. DB Hub riêng (HUB_TEST_DATABASE_URL).
// CHECK/RLS chéo tenant/agent_runtime: tests/acceptance/P-c/db.int.test.ts (D01–D08).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { autofixResults } from "./schema/hub-autofix";
import { resetTestDb, withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const api = new URL(OWNER);
api.username = "hub_api";
api.password = "hub_api_dev_pw";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(api.toString(), { max: 1 });
const T1 = "0c000000-0000-4000-8000-000000000001";
const U1 = "0c000000-0000-4000-8000-000000000002";
const ME: HubScope = { kind: "user", tenantId: T1, userId: U1 };
const STAGE = "0c000000-0000-4000-8000-000000000003";
let runId = "";
let attId = "";
let jobSeq = 100;
const job = () => `0c000000-0000-4000-8000-${String(jobSeq++).padStart(12, "0")}`;

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (err: { code?: string; cause?: { code?: string } }) =>
      err.code ?? err.cause?.code ?? String(err),
  );
const base = () => ({
  tenantId: T1,
  processRunId: runId,
  stageRunId: STAGE,
  jobId: job(),
  round: 1,
  sourceKey: "app-repo",
  pin: { kind: "git_remote" as const, url: "https://example.test/r.git", sha: "a".repeat(40) },
  branch: `ai/${runId}/fix`,
  baseSha: "1".repeat(40),
  headSha: "2".repeat(40),
});

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  const [d] = await owner<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${T1}, 'pc-def', 'pc', ${owner.json([{ key: "fix" }])}) returning id`;
  const [c] = await owner<{ id: string }[]>`insert into hub.conversations
    (tenant_id, user_id, title, title_norm) values (${T1}, ${U1}, 'c', 'c') returning id`;
  const [r] = await owner<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version,
      snapshot, started_by, origin_kind, input, conversation_id, flow_id, expires_at)
    values (${T1}, ${d?.id ?? ""}, 1, ${owner.json({})}, ${U1}, 'admin', 'x', ${c?.id ?? ""}, gen_random_uuid(),
      now() + interval '1 day') returning id`;
  runId = r?.id ?? "";
  attId = crypto.randomUUID();
  await owner`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256,
      storage_key)
    values (${attId}, ${T1}, ${U1}, 'upload', 'fix-r1.diff.txt', 'fix-r1.diff.txt', 'text/plain', 10,
      ${"0".repeat(64)}, ${`${T1}/${attId}`})`;
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("HUB-FR-130 · 0031 Drizzle autofixResults (hub_api)", () => {
  test("PC-R12 · insert/select user scope: jsonb khứ hồi, default failures/commands = []", async () => {
    const row = { ...base(), status: "ok" as const, diffAttachmentId: attId };
    const got = await withHubScope(db, ME, async (tx) => {
      await tx.insert(autofixResults).values({
        ...row,
        diffStats: { files: 1, insertions: 2, deletions: 0, bytes: 40 },
        testExitCode: 0,
        testDurationMs: 12,
      });
      return tx.select().from(autofixResults).where(eq(autofixResults.jobId, row.jobId));
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      status: "ok",
      pin: row.pin,
      failures: [],
      commands: [],
      diffStats: { files: 1, insertions: 2, deletions: 0, bytes: 40 },
      diffAttachmentId: attId,
      testLogAttachmentId: null,
    });
  });

  test("PC-R12 · append-only: update/delete Drizzle bằng hub_api ⇒ 42501", async () => {
    const upd = withHubScope(db, ME, (tx) =>
      tx
        .update(autofixResults)
        .set({ status: "no_changes" })
        .where(eq(autofixResults.tenantId, T1)),
    );
    const del = withHubScope(db, ME, (tx) =>
      tx.delete(autofixResults).where(eq(autofixResults.tenantId, T1)),
    );
    expect([await code(upd), await code(del)]).toEqual(["42501", "42501"]);
  });

  test("FK: xoá attachment ⇒ diff_attachment_id SET NULL; xoá run ⇒ CASCADE", async () => {
    await owner`delete from hub.attachments where id = ${attId}`;
    const left = await owner<
      { d: string | null }[]
    >`select diff_attachment_id as d from hub.autofix_results
      where process_run_id = ${runId}`;
    expect(left.map((r) => r.d)).toEqual([null]);
    await owner`delete from hub.process_runs where id = ${runId}`;
    const [n] = await owner<{ n: number }[]>`select count(*)::int as n from hub.autofix_results`;
    expect(n?.n).toBe(0);
  });
});

describe("HUB-FR-130 · 0031 idempotent + index", () => {
  test("đủ 4 index; chạy lại toàn bộ câu hai lần ⇒ không lỗi, ràng buộc/policy/quyền không đổi", async () => {
    const snap = async () =>
      (
        await owner<
          { n: string }[]
        >`select conrelid::regclass || ':' || conname || ':' || pg_get_constraintdef(oid) as n
            from pg_constraint where conrelid in ('hub.autofix_results'::regclass, 'hub.review_tasks'::regclass,
              'hub.jobs'::regclass)
          union all select 'idx:' || indexname || ':' || indexdef from pg_indexes
            where schemaname = 'hub' and tablename = 'autofix_results'
          union all select 'pol:' || policyname || ':' || array_to_string(roles, ',') from pg_policies
            where schemaname = 'hub' and tablename = 'autofix_results'
          union all select 'acl:' || coalesce(array_to_string(relacl, ','), '') from pg_class
            where oid = 'hub.autofix_results'::regclass
          order by 1`
      ).map((r) => r.n);
    const before = await snap();
    for (const i of ["stage", "run", "diff_att", "log_att"])
      expect(before.some((s) => s.startsWith(`idx:autofix_results_${i}_idx:`))).toBe(true);
    const stmts = readFileSync(
      new URL("../migrations-hub/0031_pc_autofix.sql", import.meta.url),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (let k = 0; k < 2; k++) for (const s of stmts) await owner.unsafe(s);
    expect(await snap()).toEqual(before);
  });
});
