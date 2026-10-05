// HUB-FR-91 · HUB-FR-94 · HUB-FR-62 · migration 0006_h2b_routing (D1, plan H2b §3, plan-db §1, §5): runs `direct`
// + responder + Orchestrator theo tenant, index đếm run đang chạy, orchestrator_settings theo tenant, jobs `refused`.
// Chạy trên DB Hub riêng (HUB_TEST_DATABASE_URL). Dữ liệu giả, không gọi dịch vụ ngoài.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { resetTestDb, withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });

const T1 = "01900000-0000-7000-8000-0000000e3a01";
const T2 = "01900000-0000-7000-8000-0000000e3a02";
const U1 = "01900000-0000-7000-8000-0000000e3b01";
const AG = "01900000-0000-7000-8000-0000000e3c01";
const PROFILE = "01900000-0000-7000-8000-0000000e3d01";
const ch = { conv: "", flow: "", run: "", step: "" };

/** Mã lỗi Postgres + tên ràng buộc (`23514:runs_direct_ck`); thành công = "ok". */
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; constraint_name?: string }) =>
      e.constraint_name ? `${e.code}:${e.constraint_name}` : (e.code ?? String(e)),
  );

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into hub.providers (key, kind, vendor) values ('fake-cli', 'subscription', 'fake')`;
  await owner`insert into hub.model_profiles (id, key, steps)
    values (${PROFILE}, 'fake-1', ${owner.json([{ provider_key: "fake-cli", model: null, on: [] }])})`;
  await owner`insert into hub.agents (id, key, name, description, runtime, profile_id)
    values (${AG}, 'orchestrator', ${owner.json({ vi: "o", en: "o" })},
      'Điều phối yêu cầu tới agent phù hợp.', 'agentic-cli', ${PROFILE})`;
  const [c] = await owner<{ id: string }[]>`insert into hub.conversations
    (tenant_id, user_id, title, title_norm) values (${T1}, ${U1}, 'c', 'c') returning id`;
  ch.conv = c?.id ?? "";
  const [f] = await owner<{ id: string }[]>`insert into hub.flows
    (tenant_id, user_id, conversation_id, title) values (${T1}, ${U1}, ${ch.conv}, 'f') returning id`;
  ch.flow = f?.id ?? "";
  const [r] = await insertRun({ kind: "orchestrated", status: "running" });
  ch.run = r?.id ?? "";
  const [s] = await owner<{ id: string }[]>`insert into hub.run_steps
    (tenant_id, user_id, run_id, seq, type, label_key, status)
    values (${T1}, ${U1}, ${ch.run}, 1, 'orchestrator', 'k', 'running') returning id`;
  ch.step = s?.id ?? "";
}, 60_000);
afterAll(async () => {
  await owner.end();
});

type RunIn = {
  kind: string;
  status?: string;
  agent?: string | null;
  orchTenant?: string | null;
  rKey?: string | null;
  rName?: string | null;
};
/** INSERT run (mặc định `finished` để không đụng `runs_flow_running_uq`). */
function insertRun(r: RunIn) {
  const st = r.status ?? "finished";
  const cmd = r.kind === "command" ? crypto.randomUUID() : null;
  return owner<
    { id: string }[]
  >`insert into hub.runs (tenant_id, user_id, conversation_id, flow_id, kind,
    command_id, agent_id, orchestrator_tenant_id, responder_key, responder_name, status, config_version,
    user_message_id, answer_message_id, finished_at)
    values (${T1}, ${U1}, ${ch.conv}, ${ch.flow}, ${r.kind}, ${cmd}, ${r.agent ?? null}, ${r.orchTenant ?? null},
      ${r.rKey ?? null}, ${r.rName ?? null}, ${st}, 1, ${crypto.randomUUID()}, ${crypto.randomUUID()},
      ${st === "running" ? null : new Date()}) returning id`;
}

const direct = { kind: "direct", agent: AG, rKey: "assistant", rName: "Trợ lý" };

describe("HUB-FR-91 · 0006_h2b_routing D1 — runs (int)", () => {
  test("lần 2 = {hub: 0, hubDev: 0}", async () => {
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });

  test("direct: đủ agent_id + responder_* → ok; thiếu agent_id / thiếu responder → 23514", async () => {
    expect(await code(insertRun(direct))).toBe("ok");
    expect(await code(insertRun({ ...direct, agent: null }))).toBe("23514:runs_direct_ck");
    expect(await code(insertRun({ ...direct, rKey: null, rName: null }))).toBe(
      "23514:runs_responder_ck",
    );
    expect(await code(insertRun({ ...direct, rName: null }))).toBe("23514:runs_responder_ck");
    expect(await code(insertRun({ ...direct, rName: "" }))).toBe("23514:runs_responder_ck");
    expect(await code(insertRun({ ...direct, rName: "x".repeat(101) }))).toBe(
      "23514:runs_responder_ck",
    );
    expect(await code(insertRun({ ...direct, rName: "x".repeat(100) }))).toBe("ok");
  });

  test("orchestrated/command: không agent_id, không responder", async () => {
    expect(await code(insertRun({ kind: "orchestrated", rKey: "a", rName: "A" }))).toBe(
      "23514:runs_responder_ck",
    );
    expect(await code(insertRun({ kind: "orchestrated", agent: AG }))).toBe("23514:runs_direct_ck");
    expect(await code(insertRun({ kind: "command" }))).toBe("ok");
  });

  test("orchestrator_tenant_id: = tenant_id và chỉ kind orchestrated", async () => {
    expect(await code(insertRun({ kind: "orchestrated", orchTenant: T1 }))).toBe("ok");
    expect(await code(insertRun({ kind: "orchestrated", orchTenant: T2 }))).toBe(
      "23514:runs_orch_tenant_ck",
    );
    expect(await code(insertRun({ kind: "command", orchTenant: T1 }))).toBe(
      "23514:runs_orch_tenant_ck",
    );
    expect(await code(insertRun({ ...direct, orchTenant: T1 }))).toBe("23514:runs_orch_tenant_ck");
  });

  test("kind lạ (workflow) → 23514 runs_kind_check (tên giữ như H2a)", async () => {
    expect(await code(insertRun({ kind: "workflow" }))).toBe("23514:runs_kind_check");
  });

  test("countRunning dùng runs_user_running_idx (partial, status='running')", async () => {
    const plan = await owner.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      return tx<{ "QUERY PLAN": string }[]>`explain select count(*)::int as n from hub.runs
        where tenant_id = ${T1} and user_id = ${U1} and status = 'running'`;
    });
    expect(plan.map((p) => p["QUERY PLAN"]).join("\n")).toContain("runs_user_running_idx");
    const [d] = await owner<
      { def: string }[]
    >`select pg_get_indexdef('hub.runs_user_running_idx'::regclass) as def`;
    expect(d?.def).toContain("WHERE (status = 'running'::text)");
  });
});

describe("HUB-FR-94 · 0006_h2b_routing D1 — orchestrator_settings, jobs (int)", () => {
  const ins = (id: number | null, tenant: string | null) =>
    id === null
      ? owner<{ id: number }[]>`insert into hub.orchestrator_settings (tenant_id, agent_id)
          values (${tenant}, ${AG}) returning id`
      : owner<{ id: number }[]>`insert into hub.orchestrator_settings (id, tenant_id, agent_id)
          values (${id}, ${tenant}, ${AG}) returning id`;

  test("hàng mặc định (1, agent, …) không tenant_id như H1 → ok", async () => {
    await owner`insert into hub.orchestrator_settings (id, agent_id, max_steps, token_budget, history_n)
      values (1, ${AG}, 5, 200000, 10)`;
    const [r] = await owner<{ tenant_id: string | null }[]>`
      select tenant_id from hub.orchestrator_settings where id = 1`;
    expect(r?.tenant_id).toBeNull();
  });

  test("hàng tenant không id → id ≥ 2 từ sequence; lần hai cùng tenant → 23505", async () => {
    const [a] = await ins(null, T1);
    expect(a?.id).toBeGreaterThanOrEqual(2);
    const [b] = await ins(null, T2);
    expect(b?.id).toBeGreaterThan(a?.id ?? 0);
    expect(await code(ins(null, T1))).toBe("23505:orchestrator_settings_tenant_uq");
  });

  test("scope: id=1 có tenant_id · id≠1 không tenant_id → 23514", async () => {
    await owner`delete from hub.orchestrator_settings where id = 1`;
    expect(await code(ins(1, crypto.randomUUID()))).toBe("23514:orchestrator_settings_scope_ck");
    expect(await code(ins(5, null))).toBe("23514:orchestrator_settings_scope_ck");
    const [c] = await owner<{ n: number }[]>`select count(*)::int as n from pg_constraint
      where conname = 'orchestrator_settings_id_check'`;
    expect(c?.n).toBe(0);
  });

  test("jobs.error_reason 'refused' → ok; giá trị lạ → 23514", async () => {
    const failed = (reason: string) =>
      owner`insert into hub.jobs (tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
        provider_key, payload, status, finished_at, error_code, error_reason, error_message)
        values (${T1}, ${U1}, ${ch.run}, ${ch.step}, ${ch.conv}, ${AG}, 'agent.cli', 'fake-cli', '{}'::jsonb,
          'failed', now(), 'UPSTREAM_ERROR', ${reason}, 'lỗi thử')`;
    expect(await code(failed("refused"))).toBe("ok");
    expect(await code(failed("upstream"))).toBe("ok");
    expect(await code(failed("nope"))).toBe("23514:jobs_error_reason_check");
  });
});

describe("HUB-FR-91 · 0006_h2b_routing D1 — idempotent (int)", () => {
  test("chạy lại toàn bộ câu của 0006 trên DB đã có → không lỗi, ràng buộc/index không đổi", async () => {
    const file = new URL("../migrations-hub/0006_h2b_routing.sql", import.meta.url);
    const stmts = readFileSync(file, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const snap = () =>
      owner<
        { n: string }[]
      >`select conname || ':' || pg_get_constraintdef(oid) as n from pg_constraint
        where conrelid in ('hub.runs'::regclass, 'hub.orchestrator_settings'::regclass, 'hub.jobs'::regclass)
        union all select indexname from pg_indexes where schemaname = 'hub' order by 1`;
    const before = (await snap()).map((r) => r.n);
    for (const s of stmts) await owner.unsafe(s);
    for (const s of stmts) await owner.unsafe(s);
    expect((await snap()).map((r) => r.n)).toEqual(before);
  });
});
