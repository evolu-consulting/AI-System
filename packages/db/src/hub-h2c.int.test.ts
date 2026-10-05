// HUB-FR-44 · HUB-FR-75 · WRK-FR-11 · WRK-FR-18 · migration 0007_h2c_attachments (D1, plan H2c §3, plan-db §1, §5):
// bảng `hub.attachments` (CHECK, FK message SET NULL, RLS, GRANT, index), `runs.attachment_ids`, jobs `attachment`,
// `conversations_deleted_idx`. Chạy trên DB Hub riêng (HUB_TEST_DATABASE_URL). Dữ liệu giả, không gọi dịch vụ ngoài.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { resetTestDb, rollbackJournalFrom, withDatabase } from "./test-db";

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
const rt = postgres(asRole("agent_runtime", "agent_runtime_dev_pw"), {
  max: 1,
  onnotice: () => {},
});

const T1 = "01900000-0000-7000-8000-0000000f3a01";
const T2 = "01900000-0000-7000-8000-0000000f3a02";
const U1 = "01900000-0000-7000-8000-0000000f3b01";
const U2 = "01900000-0000-7000-8000-0000000f3b02";
const AG = "01900000-0000-7000-8000-0000000f3c01";
const PROFILE = "01900000-0000-7000-8000-0000000f3d01";
const SHA = "a".repeat(64);
const ch = { conv: "", flow: "", msg: "", run: "", step: "" };

/** Mã lỗi Postgres + tên ràng buộc (`23514:attachments_size_check`); thành công = "ok". */
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (err: {
      code?: string;
      constraint_name?: string;
      cause?: { code?: string; constraint_name?: string };
    }) => {
      const e = err.code ? err : (err.cause ?? err); // drizzle bọc lỗi postgres trong `cause`
      return e.constraint_name ? `${e.code}:${e.constraint_name}` : (e.code ?? String(err));
    },
  );

type Att = Record<string, string | number | Date | null>;
/** Hàng hợp lệ mặc định (upload chưa gắn của T1/U1); `over` ghi đè cột; `storage_key` tính theo tenant/id. */
function row(over: Att = {}): Att {
  const id = (over.id as string | undefined) ?? crypto.randomUUID();
  const tenant = (over.tenant_id as string | undefined) ?? T1;
  return {
    id,
    tenant_id: tenant,
    user_id: U1,
    origin: "upload",
    filename: "Báo cáo.pdf",
    safe_name: "Bao_cao.pdf",
    mime: "application/pdf",
    size: 10,
    sha256: SHA,
    storage_key: `${tenant}/${id}`,
    ...over,
  };
}
const insert = (over: Att = {}) => owner`insert into hub.attachments ${owner(row(over))}`;
const bound = (msg: string, position: number): Att => ({
  message_id: msg,
  conversation_id: ch.conv,
  flow_id: ch.flow,
  bound_at: new Date(),
  position,
});

async function newMessage(tid = T1, uid = U1): Promise<string> {
  const [m] = await owner<{ id: string }[]>`insert into hub.messages
    (tenant_id, user_id, conversation_id, flow_id, role, content)
    values (${tid}, ${uid}, ${ch.conv}, ${ch.flow}, 'user', 'hi') returning id`;
  return m?.id ?? "";
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into hub.providers (key, kind, vendor) values ('fake-cli', 'subscription', 'fake')`;
  await owner`insert into hub.model_profiles (id, key, steps)
    values (${PROFILE}, 'fake-1', ${owner.json([{ provider_key: "fake-cli", model: null, on: [] }])})`;
  await owner`insert into hub.agents (id, key, name, description, runtime, profile_id)
    values (${AG}, 'a1', ${owner.json({ vi: "a", en: "a" })}, 'Điều phối yêu cầu tới agent phù hợp.', 'agentic-cli', ${PROFILE})`;
  const [c] = await owner<{ id: string }[]>`insert into hub.conversations
    (tenant_id, user_id, title, title_norm) values (${T1}, ${U1}, 'c', 'c') returning id`;
  ch.conv = c?.id ?? "";
  const [f] = await owner<{ id: string }[]>`insert into hub.flows
    (tenant_id, user_id, conversation_id, title) values (${T1}, ${U1}, ${ch.conv}, 'f') returning id`;
  ch.flow = f?.id ?? "";
  ch.msg = await newMessage();
  const [r] = await owner<
    { id: string }[]
  >`insert into hub.runs (tenant_id, user_id, conversation_id, flow_id,
    status, config_version, user_message_id, answer_message_id)
    values (${T1}, ${U1}, ${ch.conv}, ${ch.flow}, 'running', 1, ${ch.msg}, ${crypto.randomUUID()}) returning id`;
  ch.run = r?.id ?? "";
  const [s] = await owner<{ id: string }[]>`insert into hub.run_steps
    (tenant_id, user_id, run_id, seq, type, label_key, status)
    values (${T1}, ${U1}, ${ch.run}, 1, 'orchestrator', 'k', 'running') returning id`;
  ch.step = s?.id ?? "";
}, 60_000);
afterAll(async () => {
  await db.close();
  await rt.end();
  await owner.end();
});

describe("HUB-FR-44 · 0007_h2c_attachments D1 — CHECK (int)", () => {
  test("lần 2 = {hub: 0, hubDev: 0}", async () => {
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });

  test("hàng hợp lệ: upload chưa gắn · output có job_id · gắn đủ (position 0–9) → ok", async () => {
    expect(await code(insert())).toBe("ok");
    expect(await code(insert({ origin: "output", job_id: crypto.randomUUID() }))).toBe("ok");
    expect(await code(insert(bound(ch.msg, 0)))).toBe("ok");
    expect(await code(insert(bound(ch.msg, 9)))).toBe("ok");
    expect(await code(insert({ size: 20_971_520, filename: "x".repeat(200) }))).toBe("ok");
    expect(await code(insert({ safe_name: "é".repeat(60) }))).toBe("ok");
  });

  test("giá trị lệch → 23514 đúng ràng buộc", async () => {
    const cases: [Att, string][] = [
      [{ size: 0 }, "attachments_size_check"],
      [{ size: 20_971_521 }, "attachments_size_check"],
      [{ sha256: "A".repeat(64) }, "attachments_sha256_check"],
      [{ sha256: "a".repeat(63) }, "attachments_sha256_check"],
      [{ origin: "output" }, "attachments_output_job_ck"],
      [{ job_id: crypto.randomUUID() }, "attachments_output_job_ck"],
      [{ origin: "paste" }, "attachments_origin_check"],
      [{ storage_key: `${T2}/x` }, "attachments_key_ck"],
      [{ filename: "" }, "attachments_filename_check"],
      [{ filename: "x".repeat(201) }, "attachments_filename_check"],
      [{ safe_name: "é".repeat(61) }, "attachments_safe_name_check"],
      [{ mime: "application/x-msdownload" }, "attachments_mime_check"],
      [{ ...bound(ch.msg, 0), bound_at: null }, "attachments_bound_ck"],
      [{ ...bound(ch.msg, 10) }, "attachments_bound_ck"],
      [{ ...bound(ch.msg, 0), position: null }, "attachments_bound_ck"],
      [{ ...bound(ch.msg, 0), flow_id: null }, "attachments_bound_ck"],
    ];
    for (const [over, name] of cases) expect(await code(insert(over))).toBe(`23514:${name}`);
  });

  test("message_id không tồn tại → 23503 (FK)", async () => {
    expect(await code(insert({ ...bound(ch.msg, 0), message_id: crypto.randomUUID() }))).toBe(
      "23503:attachments_message_id_fkey",
    );
  });
});

describe("HUB-FR-44 · 0007_h2c_attachments D1 — CHECK FK/xoá/cột mới (int)", () => {
  test("xoá message ⇒ message_id NULL, hàng còn (bound_at/position giữ)", async () => {
    const m = await newMessage();
    const id = crypto.randomUUID();
    await insert({ id, ...bound(m, 3) });
    await owner`delete from hub.messages where id = ${m}`;
    const [a] = await owner<{ message_id: string | null; position: number; bound: boolean }[]>`
      select message_id, position, bound_at is not null as bound from hub.attachments where id = ${id}`;
    expect(a).toEqual({ message_id: null, position: 3, bound: true });
  });

  test("runs.attachment_ids: mặc định {} · 10 phần tử ok · 11 → 23514", async () => {
    const [r] = await owner<
      { ids: string[] }[]
    >`select attachment_ids as ids from hub.runs where id = ${ch.run}`;
    expect(r?.ids).toEqual([]);
    const ids = (n: number) => Array.from({ length: n }, () => crypto.randomUUID());
    const set = (n: number) =>
      owner`update hub.runs set attachment_ids = ${ids(n)}::uuid[] where id = ${ch.run}`;
    expect(await code(set(10))).toBe("ok");
    expect(await code(set(11))).toBe("23514:runs_attachment_ids_ck");
  });

  test("jobs.error_reason 'attachment' → ok; 'refused' vẫn ok; lạ → 23514", async () => {
    const failed = (reason: string) =>
      owner`insert into hub.jobs (tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
        provider_key, payload, status, finished_at, error_code, error_reason, error_message)
        values (${T1}, ${U1}, ${ch.run}, ${ch.step}, ${ch.conv}, ${AG}, 'agent.cli', 'fake-cli', '{}'::jsonb,
          'failed', now(), 'UPSTREAM_ERROR', ${reason}, 'lỗi thử')`;
    expect(await code(failed("attachment"))).toBe("ok");
    expect(await code(failed("refused"))).toBe("ok");
    expect(await code(failed("nope"))).toBe("23514:jobs_error_reason_check");
  });
});

describe("HUB-FR-75 · 0007_h2c_attachments D1 — RLS/GRANT (int)", () => {
  const ids = { u1: crypto.randomUUID(), u2: crypto.randomUUID(), t2: crypto.randomUUID() };
  const mine = [ids.u1, ids.u2, ids.t2];
  const lit = `{${mine.join(",")}}`; // literal mảng: drizzle `sql` trải mảng JS thành bộ ($1, $2, …)
  const seen = (scope: HubScope) =>
    withHubScope(db, scope, async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        dsql`select id from hub.attachments where id = any(${lit}::uuid[]) order by id`,
      );
      const upd = await tx.execute(
        dsql`update hub.attachments set filename = filename where id = any(${lit}::uuid[])`,
      );
      return { ids: [...rows].map((r) => r.id).sort(), updated: upd.count };
    });

  beforeAll(async () => {
    await insert({ id: ids.u1 });
    await insert({ id: ids.u2, user_id: U2 });
    await insert({ id: ids.t2, tenant_id: T2 });
  });

  test("user: chỉ hàng của mình (SELECT/UPDATE); khác user/tenant → 0", async () => {
    expect(await seen({ kind: "user", tenantId: T1, userId: U1 })).toEqual({
      ids: [ids.u1],
      updated: 1,
    });
    expect(await seen({ kind: "user", tenantId: T1, userId: crypto.randomUUID() })).toEqual({
      ids: [],
      updated: 0,
    });
    expect(await seen({ kind: "user", tenantId: T2, userId: U2 })).toEqual({ ids: [], updated: 0 });
  });

  test("system thấy hết; scope lạ / thiếu → 0", async () => {
    expect(await seen({ kind: "system" })).toEqual({ ids: [...mine].sort(), updated: 3 });
    const raw = (scope: string) =>
      db.db.transaction(async (tx) => {
        await tx.execute(dsql`select set_config('app.scope', ${scope}, true),
          set_config('app.tenant_id', ${T1}, true), set_config('app.user_id', ${U1}, true)`);
        const r = await tx.execute(
          dsql`select id from hub.attachments where id = any(${lit}::uuid[])`,
        );
        return [...r].length;
      });
    expect(await raw("admin")).toBe(0);
    expect(await raw("")).toBe(0);
  });
});

describe("HUB-FR-75 · 0007_h2c_attachments D1 — RLS WITH CHECK/GRANT (int)", () => {
  test("user INSERT hàng của người khác → 42501 (WITH CHECK)", async () => {
    const ins = (over: Att) =>
      code(
        withHubScope(db, { kind: "user", tenantId: T1, userId: U1 }, (tx) => {
          const r = row(over);
          return tx.execute(dsql`insert into hub.attachments (id, tenant_id, user_id, origin, filename,
            safe_name, mime, size, sha256, storage_key) values (${r.id}, ${r.tenant_id}, ${r.user_id},
            'upload', 'a.txt', 'a.txt', 'text/plain', 1, ${SHA}, ${r.storage_key})`);
        }),
      );
    expect(await ins({})).toBe("ok");
    expect(await ins({ user_id: U2 })).toBe("42501");
    expect(await ins({ tenant_id: T2 })).toBe("42501");
  });

  test("agent_runtime không GRANT: SELECT → 42501", async () => {
    expect(await code(rt`select id from hub.attachments limit 1`)).toBe("42501");
  });
});

describe("HUB-FR-44 · 0007_h2c_attachments D1 — index (int)", () => {
  const INDEXES = [
    "attachments_message_idx",
    "attachments_tenant_live_idx",
    "attachments_unbound_idx",
    "attachments_job_idx",
    "attachments_conv_live_idx",
    "conversations_deleted_idx",
  ];

  test("đủ index (pg_indexes), partial đúng điều kiện", async () => {
    const rows = await owner<{ indexname: string; indexdef: string }[]>`select indexname, indexdef
      from pg_indexes where schemaname = 'hub' and indexname = any(${INDEXES})`;
    expect(rows.map((r) => r.indexname).sort()).toEqual([...INDEXES].sort());
    const def = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(def.attachments_tenant_live_idx).toContain("INCLUDE (size) WHERE (purged_at IS NULL)");
    expect(def.attachments_unbound_idx).toContain("WHERE (message_id IS NULL)");
    expect(def.conversations_deleted_idx).toContain("WHERE (deleted_at IS NOT NULL)");
  });

  test("10 000 hàng mẫu: kiểm gửi (§2.1) và hạn mức (§3) không Seq Scan", async () => {
    await owner`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size,
      sha256, storage_key, purged_at)
      select g.id, g.t, ${U1}, 'upload', 'f.txt', 'f.txt', 'text/plain', 100, ${SHA}, g.t::text || '/' || g.id::text,
        case when g.n % 3 = 0 then now() end
      from (select gen_random_uuid() as id, n,
              ('01900000-0000-7000-8000-' || lpad(to_hex(n % 50), 12, '0'))::uuid as t
            from generate_series(1, 10000) n) g`;
    await owner`vacuum analyze hub.attachments`;
    const explain = async (q: string) =>
      (await owner.unsafe<{ "QUERY PLAN": string }[]>(`explain ${q}`))
        .map((p) => p["QUERY PLAN"])
        .join("\n");
    const check = await explain(`select id, safe_name, mime, size, sha256 from hub.attachments
      where id = any('{${crypto.randomUUID()},${crypto.randomUUID()}}'::uuid[]) and tenant_id = '${T1}'
        and user_id = '${U1}' and message_id is null and purged_at is null
        and created_at > now() - interval '24 hours'`);
    expect(check).not.toContain("Seq Scan");
    expect(check).toContain("attachments_pkey");
    const quota = await explain(`select coalesce(sum(size), 0)::bigint as used from hub.attachments
      where tenant_id = '${T1}' and purged_at is null`);
    expect(quota).not.toContain("Seq Scan");
    expect(quota).toContain("attachments_tenant_live_idx");
  });
});

describe("HUB-FR-44 · 0007_h2c_attachments D1 — idempotent (int)", () => {
  const file = new URL("../migrations-hub/0007_h2c_attachments.sql", import.meta.url);
  const stmts = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const snap = async () =>
    (
      await owner<
        { n: string }[]
      >`select conname || ':' || pg_get_constraintdef(oid) as n from pg_constraint
        where conrelid in ('hub.attachments'::regclass, 'hub.runs'::regclass, 'hub.jobs'::regclass)
        union all select indexname || ':' || indexdef from pg_indexes where schemaname = 'hub'
        union all select policyname || ':' || coalesce(qual, '') from pg_policies where schemaname = 'hub'
        union all select grantee || ':' || privilege_type from information_schema.role_table_grants
          where table_schema = 'hub' and table_name = 'attachments'
        order by 1`
    ).map((r) => r.n);

  test("chạy lại toàn bộ câu của 0007 hai lần → không lỗi, ràng buộc/index/policy/grant không đổi", async () => {
    const before = await snap();
    for (const s of stmts) await owner.unsafe(s);
    for (const s of stmts) await owner.unsafe(s);
    expect(await snap()).toEqual(before);
  });

  test("DB đã có 0006 (gỡ 0007 + dòng journal) → áp 0007 (+ migration sau nó); run cũ nhận attachment_ids {}", async () => {
    const before = await snap();
    await owner`drop table hub.attachments`;
    await owner`drop index hub.conversations_deleted_idx`;
    await owner`update hub.jobs set error_reason = 'upstream' where error_reason = 'attachment'`;
    await owner`alter table hub.runs drop column attachment_ids`;
    await owner.unsafe(`alter table hub.jobs drop constraint jobs_error_reason_check;
      alter table hub.jobs add constraint jobs_error_reason_check check (error_reason is null or error_reason in
      ('quota', 'tenant_slots', 'provider_busy', 'provider_unavailable', 'orphaned', 'crash', 'cancelled', 'timeout',
       'invalid_payload', 'invalid_output', 'sandbox', 'credential', 'upstream', 'refused'))`);
    // Gỡ dòng journal của 0007 và mọi migration sau nó (0008+ idempotent, áp lại không đổi gì).
    const removed = await rollbackJournalFrom(owner, 7);
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({
      hub: removed,
      hubDev: 0,
    });
    const [r] = await owner<
      { ids: string[] }[]
    >`select attachment_ids as ids from hub.runs where id = ${ch.run}`;
    expect(r?.ids).toEqual([]);
    expect(await snap()).toEqual(before);
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });
});
