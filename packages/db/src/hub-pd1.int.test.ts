// HUB-FR-143 · HUB-FR-144 · HUB-FR-145 · HUB-FR-115 · migration 0036_pd1_durable (spec P-d §4–§5, plan-db §1): Drizzle
// `processTimers` + cột mới ghi/đọc bằng `hub_api` (NOBYPASSRLS): cách ly tenant (S1), FK kép (id, tenant_id) từ chối hàng
// lệch tenant, không DELETE, CASCADE theo run, mặc định cột mới, `HUB_AUDIT_ACTION_VALUES` khớp CHECK DB.
// Metadata/CHECK chi tiết + chạy lại 0036: tests/acceptance/P-d/d1/db.int.test.ts (PD-I68…I72).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { HUB_AUDIT_ACTION_VALUES } from "./schema/hub";
import {
  processDefs,
  processRuns,
  processTimers,
  reviewTasks,
  stageRuns,
} from "./schema/hub-processes";
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

const x = (n: number) => `0d100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T1 = x(1);
const T2 = x(2);
const U1 = x(3);
const U2 = x(4);
const A: HubScope = { kind: "user", tenantId: T1, userId: U1 };
const B: HubScope = { kind: "user", tenantId: T2, userId: U2 };
type Fix = { defId: string; runId: string; stageId: string };
const fix: Record<string, Fix> = {};
let keySeq = 0;
const key = () => `pd1-k-${++keySeq}`;

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code ?? String(e),
  );

/** Def + run + stage 0 của một tenant, ghi bằng owner (bỏ qua RLS); run kiểu cũ có `expires_at`. */
async function seed(tid: string, uid: string): Promise<Fix> {
  const [d] = await owner<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, ${`pd1-${tid.slice(-1)}`}, 'pd1', ${owner.json([{ key: "s" }])}) returning id`;
  const [c] = await owner<{ id: string }[]>`insert into hub.conversations
    (tenant_id, user_id, title, title_norm) values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [r] = await owner<{ id: string }[]>`insert into hub.process_runs (tenant_id, process_def_id,
      def_version, snapshot, started_by, origin_kind, input, conversation_id, flow_id, expires_at)
    values (${tid}, ${d?.id ?? ""}, 1, ${owner.json({})}, ${uid}, 'admin', 'x', ${c?.id ?? ""},
      gen_random_uuid(), now() + interval '7 days') returning id`;
  const [s] = await owner<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx)
    values (${tid}, ${r?.id ?? ""}, 0) returning id`;
  return { defId: d?.id ?? "", runId: r?.id ?? "", stageId: s?.id ?? "" };
}

const timer = (f: Fix, tenantId: string, o: Partial<typeof processTimers.$inferInsert> = {}) => ({
  tenantId,
  processRunId: f.runId,
  stageRunId: f.stageId,
  kind: "retry" as const,
  dueAt: new Date(Date.now() + 60_000),
  idempotencyKey: key(),
  ...o,
});

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  fix.a = await seed(T1, U1);
  fix.b = await seed(T2, U2);
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("HUB-FR-143 · 0036 process_timers (hub_api, RLS T)", () => {
  test("PD-R11 · S1 · user scope chỉ thấy hẹn của tenant mình; system thấy cả hai", async () => {
    const a = fix.a as Fix;
    const b = fix.b as Fix;
    await withHubScope(db, A, (tx) =>
      tx
        .insert(processTimers)
        .values(timer(a, T1, { kind: "wait_until", timezone: "Asia/Ho_Chi_Minh" })),
    );
    await withHubScope(db, B, (tx) => tx.insert(processTimers).values(timer(b, T2)));
    const seen = (s: HubScope) =>
      withHubScope(db, s, async (tx) =>
        (await tx.select({ t: processTimers.tenantId }).from(processTimers)).map((r) => r.t).sort(),
      );
    expect(await seen(A)).toEqual([T1]);
    expect(await seen(B)).toEqual([T2]);
    expect(await seen({ kind: "user", tenantId: T2, userId: U1 })).toEqual([T2]);
    expect(await seen({ kind: "system" })).toEqual([T1, T2]);
    // Ngoài withHubScope ⇒ 0 hàng.
    expect((await db.db.select().from(processTimers)).length).toBe(0);
  });

  test("HUB-BR-14 · ghi hẹn tenant khác trong scope A ⇒ 42501; sửa sang tenant khác ⇒ 42501", async () => {
    const b = fix.b as Fix;
    expect(
      await code(withHubScope(db, A, (tx) => tx.insert(processTimers).values(timer(b, T2)))),
    ).toBe("42501");
    expect(
      await code(withHubScope(db, A, (tx) => tx.update(processTimers).set({ tenantId: T2 }))),
    ).toBe("42501");
  });
});

describe("AC-H46 · 0036 process_timers FK kép (tenant)", () => {
  test("AC-H46 · FK kép: hàng mang tenant T2 trỏ run/stage của T1 ⇒ 23503 (kể cả scope system)", async () => {
    const a = fix.a as Fix;
    const b = fix.b as Fix;
    const sys: HubScope = { kind: "system" };
    // run của T1, tenant T2 ⇒ lệch FK run.
    expect(
      await code(withHubScope(db, sys, (tx) => tx.insert(processTimers).values(timer(a, T2)))),
    ).toBe("23503");
    // run đúng T2 nhưng stage của T1 ⇒ lệch FK stage.
    expect(
      await code(
        withHubScope(db, sys, (tx) =>
          tx.insert(processTimers).values(timer({ ...b, stageId: a.stageId }, T2)),
        ),
      ),
    ).toBe("23503");
  });
});

describe("S4 · 0036 process_timers không DELETE", () => {
  test("S4 · không DELETE (42501); huỷ = cancelled_at; xoá run (owner) CASCADE hẹn", async () => {
    const a = fix.a as Fix;
    expect(await code(withHubScope(db, A, (tx) => tx.delete(processTimers)))).toBe("42501");
    const n = await withHubScope(db, A, async (tx) => {
      const rows = await tx
        .update(processTimers)
        .set({ cancelledAt: new Date() })
        .where(eq(processTimers.processRunId, a.runId))
        .returning({ id: processTimers.id });
      return rows.length;
    });
    expect(n).toBeGreaterThan(0);
    // Run phụ của T1 (expires_at NULL — 0036 DROP NOT NULL) để thử CASCADE mà không đụng fixture chung.
    const [r] = await owner<
      { id: string }[]
    >`insert into hub.process_runs (tenant_id, process_def_id,
        def_version, snapshot, started_by, origin_kind, input, conversation_id, flow_id, expires_at)
      select tenant_id, process_def_id, 1, '{}'::jsonb, started_by, 'admin', 'y', conversation_id,
        gen_random_uuid(), null from hub.process_runs where id = ${a.runId} returning id`;
    const [s] = await owner<
      { id: string }[]
    >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx)
      values (${T1}, ${r?.id ?? ""}, 0) returning id`;
    const tmp = { ...a, runId: r?.id ?? "", stageId: s?.id ?? "" };
    await withHubScope(db, A, (tx) => tx.insert(processTimers).values(timer(tmp, T1)));
    await owner`delete from hub.process_runs where id = ${tmp.runId}`;
    const [left] = await owner<{ n: number }[]>`select count(*)::int as n from hub.process_timers
      where process_run_id = ${tmp.runId}`;
    expect(left?.n).toBe(0);
  });
});

describe("HUB-FR-115 · HUB-FR-144 · 0036 cột mới (Drizzle, hub_api)", () => {
  test("hàng cũ nhận mặc định: ttl_days 7, retry_count 0, remind_count 0; expires_at nhận NULL", async () => {
    const a = fix.a as Fix;
    const got = await withHubScope(db, { kind: "system" }, async (tx) => {
      const [d] = await tx
        .select({ ttl: processDefs.ttlDays })
        .from(processDefs)
        .where(eq(processDefs.id, a.defId));
      const [s] = await tx
        .select({ n: stageRuns.retryCount, e: stageRuns.lastErrorCode })
        .from(stageRuns)
        .where(eq(stageRuns.id, a.stageId));
      await tx.update(processRuns).set({ expiresAt: null }).where(eq(processRuns.id, a.runId));
      const [r] = await tx
        .select({ exp: processRuns.expiresAt })
        .from(processRuns)
        .where(eq(processRuns.id, a.runId));
      return { ttl: d?.ttl, retry: s?.n, err: s?.e, exp: r?.exp };
    });
    expect(got).toEqual({ ttl: 7, retry: 0, err: null, exp: null });
  });
});

describe("HUB-FR-145 · 0036 review_tasks + audit (Drizzle, hub_api)", () => {
  test("review_tasks: remind_count mặc định 0; escalate_at thiếu group ⇒ 23514; ask có remind_every_h ⇒ 23514", async () => {
    const a = fix.a as Fix;
    const [t] = await owner<{ id: string; remind_count: number }[]>`insert into hub.review_tasks
        (tenant_id, process_run_id, stage_run_id, kind, question, remind_at)
      values (${T1}, ${a.runId}, ${a.stageId}, 'ask', 'q?', now()) returning id, remind_count`;
    expect(t?.remind_count).toBe(0);
    const set = (o: Partial<typeof reviewTasks.$inferInsert>) =>
      code(
        withHubScope(db, A, (tx) =>
          tx
            .update(reviewTasks)
            .set(o)
            .where(eq(reviewTasks.id, t?.id ?? "")),
        ),
      );
    expect(await set({ escalateAt: new Date() })).toBe("23514");
    expect(await set({ remindEveryH: 24 })).toBe("23514");
    expect(await set({ remindCount: 1 })).toBe("ok");
  });

  test("HUB_AUDIT_ACTION_VALUES khớp đúng CHECK hub_audit_log_action_check (gồm escalate, escalate_skipped)", async () => {
    const [c] = await owner<
      { def: string }[]
    >`select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'hub_audit_log_action_check' and conrelid = 'hub.audit_log'::regclass`;
    const inDb = [...(c?.def ?? "").matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(inDb).toEqual([...HUB_AUDIT_ACTION_VALUES].sort());
  });
});
