// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · HUB-FR-134 · CR-073 · migration 0029_k1_kh (spec K1 §4, plan §5): 5 bảng, RLS "T"
// (`v_t`) cho 3 bảng run, GRANT hub_rw (kh_jobs không UPDATE/DELETE), FK RESTRICT secret/kết nối + CASCADE, CHECK, unique
// hoa-thường, audit CHECK, Drizzle `hub-kh.ts` chạy với `hub_api`, chạy lại idempotent. DB Hub riêng (HUB_TEST_DATABASE_URL).
// Hàng run (kh_jobs/kh_stage_usage/kh_writes) chèn bằng owner với `session_replication_role = replica` (bỏ FK) — chỉ để thử
// RLS; hành vi CASCADE của chúng kiểm qua `confdeltype`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { HUB_AUDIT_ACTION_VALUES, HUB_AUDIT_ENTITY_VALUES } from "./schema/hub";
import { agentKh, khConnections, khJobs, khStageUsage, khWrites } from "./schema/hub-kh";
import { resetTestDb, withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const asRole = (user: string, pw: string) => {
  const u = new URL(OWNER);
  u.username = user;
  u.password = pw;
  return u.toString();
};
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(asRole("hub_api", "hub_api_dev_pw"), { max: 1 });

const id = (n: number) => `c1a1f000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T1 = id(1);
const T2 = id(2);
const U1 = id(3);
const PROFILE = id(10);
const AG = id(11);
const SEC = id(20);
const CONN = id(30);
const SYS: HubScope = { kind: "system" };
const user = (tenantId: string): HubScope => ({ kind: "user", tenantId, userId: U1 });
const rnd = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
const RUN_TABLES = ["kh_jobs", "kh_stage_usage", "kh_writes"] as const;

/** SQLSTATE (kể cả lỗi bọc trong `cause` của Drizzle); thành công = "ok". */
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (err: { code?: string; cause?: { code?: string } }) =>
      err.code ?? err.cause?.code ?? String(err),
  );

const conn = (o: { id?: string; name: string; url: string; summary?: string | null }) =>
  owner`insert into hub.kh_connections (id, name, base_url, secret_id, summary_project)
    values (${o.id ?? crypto.randomUUID()}, ${o.name}, ${o.url}, ${SEC}, ${o.summary ?? null})`;

/** Một hàng mỗi bảng run cho `tenant` (bỏ FK bằng replica — chỉ để thử RLS). */
async function seedRunRows(tenant: string, n: number): Promise<void> {
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.kh_jobs (job_id, tenant_id, items)
      values (${id(100 + n)}, ${tenant}, ${tx.json([{ connection_id: CONN, name: "kh-main", summary_project: null, projects: ["p"] }])})`;
    await tx`insert into hub.kh_stage_usage (stage_run_id, attempt, round, tenant_id, queries)
      values (${id(200 + n)}, 1, 1, ${tenant}, 2)`;
    await tx`insert into hub.kh_writes (id, tenant_id, process_run_id, stage_run_id, output_id, connection_id,
        project_id, subject, body, vector_id)
      values (${id(300 + n)}, ${tenant}, ${id(400 + n)}, ${id(200 + n)}, ${id(500 + n)}, ${CONN},
        'proj-a', 'k1/a0', 'tóm tắt', ${`kw-${n}`})`;
  });
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv)
    values (${SEC}, 'kh_api_key', null, 'kh-key-main', ${rnd(40)}, ${rnd(12)})`;
  await owner`insert into hub.providers (key, kind, vendor) values ('fake-k1', 'subscription', 'fake')`;
  await owner`insert into hub.model_profiles (id, key, steps)
    values (${PROFILE}, 'fake-k1', ${owner.json([{ provider_key: "fake-k1", model: null, on: [] }])})`;
  await owner`insert into hub.agents (id, key, name, description, runtime, profile_id)
    values (${AG}, 'k1-agent', ${owner.json({ vi: "a", en: "a" })}, 'Agent thử cho migration K1 0029.', 'agentic-cli', ${PROFILE})`;
  await conn({ id: CONN, name: "kh-main", url: "https://kh.example.com", summary: "proj-a" });
  await seedRunRows(T1, 1);
  await seedRunRows(T2, 2);
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("HUB-FR-131 · bảng + Drizzle hub-kh (hub_api)", () => {
  test("5 bảng có; Drizzle select/insert kết nối + agent_kh ở scope system", async () => {
    const [r] = await owner<{ n: number }[]>`select count(*)::int as n from pg_class
      where relnamespace = 'hub'::regnamespace and relname in
        ('kh_connections', 'agent_kh', 'kh_jobs', 'kh_stage_usage', 'kh_writes')`;
    expect(r?.n).toBe(5);
    const rows = await withHubScope(db, SYS, (tx) =>
      tx.select().from(khConnections).where(eq(khConnections.id, CONN)),
    );
    expect(rows[0]).toMatchObject({ name: "kh-main", checkStatus: "unchecked", version: 1 });
    await withHubScope(db, SYS, (tx) =>
      tx.insert(agentKh).values({ agentId: AG, connectionId: CONN, position: 0 }),
    );
    const ak = await withHubScope(db, SYS, (tx) => tx.select().from(agentKh));
    expect(ak).toEqual([expect.objectContaining({ agentId: AG, connectionId: CONN, position: 0 })]);
  });
});

describe("HUB-BR-36 · RLS v_t cho kh_jobs / kh_stage_usage / kh_writes", () => {
  const TABLES = [khJobs, khStageUsage, khWrites] as const;
  const count = (scope: HubScope | null) =>
    Promise.all(
      TABLES.map((t) =>
        (scope
          ? withHubScope(db, scope, (tx) => tx.select({ t: t.tenantId }).from(t))
          : db.db.select({ t: t.tenantId }).from(t)
        ).then((r) => r.length),
      ),
    );
  test("system thấy hết; user T1/T2 chỉ hàng mình; không scope ⇒ 0", async () => {
    expect(await count(SYS)).toEqual([2, 2, 2]);
    expect(await count(user(T1))).toEqual([1, 1, 1]);
    expect(await count(user(T2))).toEqual([1, 1, 1]);
    expect(await count(null)).toEqual([0, 0, 0]);
  });
  test("user T1 ghi hàng T2 ⇒ 42501 (WITH CHECK); ghi hàng T1 qua RLS rồi vấp FK ⇒ 23503", async () => {
    const ins = (tenant: string) =>
      code(
        withHubScope(db, user(T1), (tx) =>
          tx
            .insert(khStageUsage)
            .values({ stageRunId: id(299), attempt: 1, round: 1, tenantId: tenant }),
        ),
      );
    expect([await ins(T2), await ins(T1)]).toEqual(["42501", "23503"]);
  });
  test("user T1 không sửa được hàng T2 (0 hàng)", async () => {
    const up = await withHubScope(db, user(T1), (tx) =>
      tx
        .update(khWrites)
        .set({ status: "skipped" })
        .where(eq(khWrites.tenantId, T2))
        .returning({ id: khWrites.id }),
    );
    expect(up).toEqual([]);
  });
});

describe("HUB-BR-36 · policy + GRANT 0029", () => {
  test("policy + GRANT: kh_jobs không UPDATE/DELETE; 3 bảng run không DELETE; không quyền hub_ro/agent_runtime", async () => {
    const pol = await owner<{ t: string }[]>`select tablename as t from pg_policies
      where schemaname = 'hub' and policyname = tablename || '_hub_rw' and tablename in ${owner(RUN_TABLES)}
      order by 1`;
    expect(pol.map((p) => p.t)).toEqual(["kh_jobs", "kh_stage_usage", "kh_writes"]);
    const priv = (role: string, t: string, p: string) =>
      owner<{ ok: boolean }[]>`select has_table_privilege(${role}, ${`hub.${t}`}, ${p}) as ok`.then(
        (r) => r[0]?.ok,
      );
    expect([
      await priv("hub_rw", "kh_jobs", "UPDATE"),
      await priv("hub_rw", "kh_jobs", "DELETE"),
      await priv("hub_rw", "kh_writes", "DELETE"),
      await priv("hub_rw", "kh_stage_usage", "UPDATE"),
      await priv("hub_rw", "kh_connections", "DELETE"),
      await priv("hub_ro", "kh_connections", "SELECT"),
      await priv("agent_runtime", "kh_writes", "SELECT"),
    ]).toEqual([false, false, false, true, true, false, false]);
  });
});

describe("HUB-FR-131 · HUB-FR-132 · FK RESTRICT/CASCADE", () => {
  test("FK đúng luật xoá (r = RESTRICT, c = CASCADE)", async () => {
    const rows = await owner<
      { n: string }[]
    >`select conname || ':' || confdeltype::text as n from pg_constraint
      where contype = 'f' and conrelid in ('hub.kh_connections'::regclass, 'hub.agent_kh'::regclass,
        'hub.kh_jobs'::regclass, 'hub.kh_stage_usage'::regclass, 'hub.kh_writes'::regclass) order by 1`;
    expect(rows.map((r) => r.n)).toEqual([
      "agent_kh_agent_fk:c",
      "agent_kh_conn_fk:r",
      "kh_connections_secret_fk:r",
      "kh_jobs_job_fk:c",
      "kh_stage_usage_stage_fk:c",
      "kh_writes_output_fk:c",
      "kh_writes_run_fk:c",
      "kh_writes_stage_fk:c",
    ]);
  });
  test("RESTRICT: xoá secret đang dùng / kết nối đang tick ⇒ 23503; xoá agent ⇒ agent_kh CASCADE", async () => {
    expect(await code(owner`delete from hub.secrets where id = ${SEC}`)).toBe("23503");
    expect(await code(owner`delete from hub.kh_connections where id = ${CONN}`)).toBe("23503");
    await owner`delete from hub.agents where id = ${AG}`;
    const [r] = await owner<{ n: number }[]>`select count(*)::int as n from hub.agent_kh`;
    expect(r?.n).toBe(0);
    expect(await code(owner`delete from hub.kh_connections where id = ${CONN}`)).toBe("ok");
    await conn({ id: CONN, name: "kh-main", url: "https://kh.example.com", summary: "proj-a" });
  });
});

describe("HUB-FR-131 · CHECK + unique", () => {
  const up = (q: string) => () => code(owner.unsafe(`update hub.${q} where tenant_id = '${T1}'`));
  const cases: [string, () => Promise<string>, string][] = [
    ["name /", () => code(conn({ name: "a/b", url: "https://a.example.com" })), "23514"],
    ["name rỗng", () => code(conn({ name: "   ", url: "https://b.example.com" })), "23514"],
    ["name 81", () => code(conn({ name: "x".repeat(81), url: "https://c.example.com" })), "23514"],
    [
      "summary a/b",
      () => code(conn({ name: "ok-1", url: "https://d.example.com", summary: "a/b" })),
      "23514",
    ],
    ["url < 8", () => code(conn({ name: "ok-2", url: "http://" })), "23514"],
    ["lower(name)", () => code(conn({ name: "KH-MAIN", url: "https://e.example.com" })), "23505"],
    ["base_url", () => code(conn({ name: "kh-other", url: "https://kh.example.com" })), "23505"],
    [
      "check_status",
      () => code(owner`update hub.kh_connections set check_status = 'pending' where id = ${CONN}`),
      "23514",
    ],
    [
      "check_result mảng",
      () => code(owner`update hub.kh_connections set check_result = '[]' where id = ${CONN}`),
      "23514",
    ],
    ["queries 6", up("kh_stage_usage set queries = 6"), "23514"],
    ["warning lạ", up("kh_stage_usage set last_warning = 'ns_suspended'"), "23514"],
    ["warning disabled", up("kh_stage_usage set last_warning = 'disabled'"), "ok"],
    ["items []", up("kh_jobs set items = '[]'"), "23514"],
    ["status lạ", up("kh_writes set status = 'sent'"), "23514"],
    ["attempts 6", up("kh_writes set attempts = 6"), "23514"],
    ["project a/b", up("kh_writes set project_id = 'a/b'"), "23514"],
  ];
  test("CHECK + unique lower(name)/base_url", async () => {
    const got: string[] = [];
    for (const [label, run] of cases) got.push(`${label}:${await run()}`);
    expect(got).toEqual(cases.map(([label, , want]) => `${label}:${want}`));
  });
});

describe("HUB-FR-132 · agent_kh", () => {
  test("agent_kh: position 0..4, duy nhất (agent, position)", async () => {
    await owner`insert into hub.agents (id, key, name, description, runtime, profile_id)
      values (${AG}, 'k1-agent', ${owner.json({ vi: "a", en: "a" })}, 'Agent thử cho migration K1 0029.', 'agentic-cli', ${PROFILE})`;
    const c2 = crypto.randomUUID();
    await conn({ id: c2, name: "kh-two", url: "https://two.example.com" });
    const tick = (c: string, p: number) =>
      code(
        owner`insert into hub.agent_kh (agent_id, connection_id, position) values (${AG}, ${c}, ${p})`,
      );
    expect([
      await tick(CONN, 5),
      await tick(CONN, 0),
      await tick(c2, 0),
      await tick(c2, 1),
    ]).toEqual(["23514", "ok", "23505", "ok"]);
  });
});

describe("HUB-FR-131 · audit CHECK 0029", () => {
  test("nhận check/degrade/write_fail + kh_connection/kh_query/kh_worklog; giữ rotate/secret; hằng Drizzle khớp", async () => {
    expect(HUB_AUDIT_ACTION_VALUES).toEqual(
      expect.arrayContaining(["check", "degrade", "write_fail", "rotate"]),
    );
    expect(HUB_AUDIT_ENTITY_VALUES).toEqual(
      expect.arrayContaining(["kh_connection", "kh_query", "kh_worklog", "secret"]),
    );
    const ins = (action: string, entity: string) =>
      code(owner`insert into hub.audit_log (actor_id, actor_role, action, entity, entity_id, entity_name)
        values (${null}, ${null}, ${action}, ${entity}, ${CONN}, 'kh-main')`);
    expect([
      await ins("check", "kh_connection"),
      await ins("degrade", "kh_query"),
      await ins("write_fail", "kh_worklog"),
      await ins("rotate", "secret"),
      await ins("x", "kh_connection"),
      await ins("check", "kh_tenant"),
    ]).toEqual(["ok", "ok", "ok", "ok", "23514", "23514"]);
  });
});

describe("HUB-FR-131 · 0029 idempotent", () => {
  test("chạy lại toàn bộ câu hai lần ⇒ không lỗi, ràng buộc/index/policy/quyền không đổi", async () => {
    // Chạy lại chuỗi 0029 → 0030: 0030 (H4b-2) mở rộng CHECK entity của 0029 nên "chạy lại 0029" phải kèm 0030 để trạng thái cuối khớp.
    const stmts = ["0029_k1_kh.sql", "0030_h4b2_models.sql"].flatMap((f) =>
      readFileSync(new URL(`../migrations-hub/${f}`, import.meta.url), "utf8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
    const snap = async () =>
      (
        await owner<
          { n: string }[]
        >`select conrelid::regclass || ':' || conname || ':' || pg_get_constraintdef(oid) as n
          from pg_constraint where conrelid::regclass::text like 'hub.%kh%'
          union all select indexname || ':' || indexdef from pg_indexes
            where schemaname = 'hub' and tablename like '%kh%'
          union all select policyname || ':' || coalesce(qual, '') from pg_policies
            where schemaname = 'hub' and tablename like '%kh%'
          union all select 'acl:' || relname || ':' || coalesce(array_to_string(relacl, ','), '') from pg_class
            where relnamespace = 'hub'::regnamespace and relkind = 'r' and relname like '%kh%'
          union all select conname || ':' || pg_get_constraintdef(oid) from pg_constraint
            where conrelid = 'hub.audit_log'::regclass and contype = 'c'
          order by 1`
      ).map((r) => r.n);
    const before = await snap();
    for (let i = 0; i < 2; i++) for (const s of stmts) await owner.unsafe(s);
    expect(await snap()).toEqual(before);
  });
});
