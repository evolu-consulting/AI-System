// HUB-FR-78 · HUB-FR-87 · migration 0009_h3b_agent_grants (D1, plan H3b §1 P3, plan-db H3b §1):
// `hub.audit_log` append-only (trigger, kể cả owner) + CHECK + 3 index, `usage_logs_run_idx`, GRANT hub_rw đúng R22/PL2
// (không hơn), idempotent, áp được trên DB đã có 0008. Chạy trên DB Hub riêng (HUB_TEST_DATABASE_URL). Dữ liệu giả.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
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
const opts = { max: 1, onnotice: () => {} };
const owner = postgres(OWNER, opts);
const api = postgres(asRole("hub_api", "hub_api_dev_pw"), opts);
const adm = postgres(asRole("admin_api", "admin_api_dev_pw"), opts);
const rt = postgres(asRole("agent_runtime", "agent_runtime_dev_pw"), opts);

const T = "00000000-0000-7000-8000-0000000000b1";
const AG = "00000000-0000-7000-8000-0000000000a1";
const PROFILE = "00000000-0000-7000-8000-0000000000c1";
const SUBJ = "00000000-0000-7000-8000-0000000000d1";

/** Mã lỗi Postgres (+ tên ràng buộc nếu có); thành công = "ok". */
const code = (p: PromiseLike<unknown>) =>
  Promise.resolve(p).then(
    () => "ok",
    (e: { code?: string; constraint_name?: string }) =>
      e.constraint_name ? `${e.code}:${e.constraint_name}` : (e.code ?? String(e)),
  );
const insertAudit = (db: postgres.Sql, cols: Record<string, unknown> = {}) => {
  const row = { tenant_id: T, action: "grant", entity: "agent_grant", ...cols };
  return db`insert into hub.audit_log ${db(row)} returning id, seq`;
};

/** Quyền (mức bảng + mức cột) của mọi role trừ owner trên các bảng D1 chạm tới — dạng `role:bảng[.cột]:quyền`. */
const acl = async () =>
  (
    await owner<{ n: string }[]>`
      select a.grantee::regrole::text || ':' || c.relname || ':' || a.privilege_type as n
        from pg_class c, aclexplode(c.relacl) a
        where c.oid in ('hub.audit_log'::regclass, 'hub.agent_grants'::regclass, 'hub.config_meta'::regclass)
          and a.grantee <> c.relowner
      union all
      select a.grantee::regrole::text || ':' || c.relname || '.' || t.attname || ':' || a.privilege_type
        from pg_attribute t join pg_class c on c.oid = t.attrelid, aclexplode(t.attacl) a
        where c.oid in ('hub.audit_log'::regclass, 'hub.agent_grants'::regclass, 'hub.config_meta'::regclass)
      order by 1`
  ).map((r) => r.n);

/** Cột `hub.audit_log` theo thứ tự: `tên:kiểu:nullable:identity` (plan-db H3b §1). */
const AUDIT_COLS = [
  "id:uuid:NO:NO",
  "seq:bigint:NO:YES",
  "at:timestamp with time zone:NO:NO",
  "tenant_id:uuid:NO:NO",
  "actor_id:uuid:YES:NO",
  "actor_username:text:YES:NO",
  "actor_role:text:YES:NO",
  "action:text:NO:NO",
  "entity:text:NO:NO",
  "entity_id:uuid:YES:NO",
  "entity_name:text:NO:NO",
  "hub_config_version:integer:YES:NO",
  "before:jsonb:YES:NO",
  "after:jsonb:YES:NO",
  "summary:jsonb:NO:NO",
];

/** Câu SQL của 0009 (chạy lại) và ảnh chụp đối tượng D1 tạo (so trước/sau). */
const FILE_0009 = new URL("../migrations-hub/0009_h3b_agent_grants.sql", import.meta.url);
const stmts = readFileSync(FILE_0009, "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const snap = async () => [
  ...(await acl()),
  ...(
    await owner<{ n: string }[]>`
      select conname || ':' || pg_get_constraintdef(oid) as n from pg_constraint
        where conrelid = 'hub.audit_log'::regclass
      union all select indexname || ':' || indexdef from pg_indexes where schemaname = 'hub'
        and (tablename = 'audit_log' or indexname = 'usage_logs_run_idx')
      union all select tgname || ':' || pg_get_triggerdef(oid) from pg_trigger
        where tgrelid = 'hub.audit_log'::regclass
      order by 1`
  ).map((r) => r.n),
];

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into hub.providers (key, kind, vendor) values ('fake-cli', 'subscription', 'fake')`;
  await owner`insert into hub.model_profiles (id, key, steps)
    values (${PROFILE}, 'fake-1', ${owner.json([{ provider_key: "fake-cli", model: null, on: [] }])})`;
  await owner`insert into hub.agents (id, key, name, description, runtime, profile_id)
    values (${AG}, 'a1', ${owner.json({ vi: "a", en: "a" })}, 'Điều phối yêu cầu tới agent phù hợp.', 'agentic-cli', ${PROFILE})`;
}, 60_000);
afterAll(async () => {
  await Promise.all([api.end(), adm.end(), rt.end()]);
  await owner.end();
});

describe("HUB-FR-87 · 0009 D1 — hub.audit_log bảng + index (int)", () => {
  test("cột đúng thứ tự/kiểu/null; tenant_id NOT NULL; seq identity", async () => {
    const cols = await owner<{ n: string }[]>`
      select column_name || ':' || data_type || ':' || is_nullable || ':' || is_identity as n
      from information_schema.columns where table_schema = 'hub' and table_name = 'audit_log'
      order by ordinal_position`;
    expect(cols.map((c) => c.n)).toEqual(AUDIT_COLS);
  });

  test("3 index audit_log + usage_logs_run_idx (partial run_id IS NOT NULL)", async () => {
    const idx = await owner<{ n: string; d: string }[]>`
      select indexname as n, indexdef as d from pg_indexes where schemaname = 'hub'
        and indexname in ('hub_audit_log_tenant_seq_idx', 'hub_audit_log_entity_seq_idx',
                          'hub_audit_log_actor_seq_idx', 'usage_logs_run_idx')
      order by 1`;
    expect(idx.map((i) => i.n)).toEqual([
      "hub_audit_log_actor_seq_idx",
      "hub_audit_log_entity_seq_idx",
      "hub_audit_log_tenant_seq_idx",
      "usage_logs_run_idx",
    ]);
    expect(idx[0]?.d).toContain("(actor_id, seq DESC)");
    expect(idx[1]?.d).toContain("(entity, entity_id, seq DESC)");
    expect(idx[2]?.d).toContain("(tenant_id, seq DESC)");
    expect(idx[3]?.d).toContain(
      "ON hub.usage_logs USING btree (run_id) WHERE (run_id IS NOT NULL)",
    );
  });

  test("CHECK chặn action/entity/actor_role lạ, entity_name 201 ký tự, tenant_id NULL", async () => {
    expect(await code(insertAudit(owner, { action: "x" }))).toBe(
      "23514:hub_audit_log_action_check",
    );
    expect(await code(insertAudit(owner, { entity: "x" }))).toBe(
      "23514:hub_audit_log_entity_check",
    );
    expect(await code(insertAudit(owner, { actor_role: "x" }))).toBe(
      "23514:hub_audit_log_actor_role_check",
    );
    expect(await code(insertAudit(owner, { entity_name: "a".repeat(201) }))).toBe(
      "23514:hub_audit_log_entity_name_check",
    );
    expect(await code(insertAudit(owner, { tenant_id: null }))).toBe("23502");
    for (const action of ["grant", "revoke", "view_trace"])
      expect(await code(insertAudit(owner, { action, entity_name: "a".repeat(200) }))).toBe("ok");
    expect(await code(insertAudit(owner, { entity: "run", actor_role: "member" }))).toBe("ok");
  });
});

describe("HUB-FR-87 · 0009 D1 — append-only (int)", () => {
  test("hub_api INSERT được (identity tự sinh, không cần GRANT sequence), SELECT được", async () => {
    const [a] = await insertAudit(api);
    const [b] = await insertAudit(api, { action: "view_trace", entity: "run" });
    expect(Number(b?.seq)).toBeGreaterThan(Number(a?.seq));
    const [r] = await api`select count(*)::int as n from hub.audit_log where id = ${a?.id ?? ""}`;
    expect(r?.n).toBe(1);
  });

  test("hub_api UPDATE/DELETE/TRUNCATE → 42501", async () => {
    expect(await code(api`update hub.audit_log set entity_name = 'x'`)).toBe("42501");
    expect(await code(api`delete from hub.audit_log`)).toBe("42501");
    expect(await code(api`truncate hub.audit_log`)).toBe("42501");
  });

  test("owner UPDATE/DELETE/TRUNCATE → P0001 (trigger), dữ liệu giữ nguyên", async () => {
    const [before] = await owner`select count(*)::int as n from hub.audit_log`;
    expect(await code(owner`update hub.audit_log set entity_name = 'x'`)).toBe("P0001");
    expect(await code(owner`delete from hub.audit_log`)).toBe("P0001");
    expect(await code(owner`truncate hub.audit_log`)).toBe("P0001");
    const [after] = await owner`select count(*)::int as n from hub.audit_log`;
    expect(after?.n).toBe(before?.n);
    expect(before?.n).toBeGreaterThan(0);
  });

  test("admin_api (admin_rw) và agent_runtime không đọc/ghi hub.audit_log → 42501", async () => {
    expect(await code(adm`select 1 from hub.audit_log limit 1`)).toBe("42501");
    expect(await code(insertAudit(adm))).toBe("42501");
    expect(await code(rt`select 1 from hub.audit_log limit 1`)).toBe("42501");
    expect(await code(insertAudit(rt))).toBe("42501");
  });
});

describe("HUB-FR-78 · 0009 D1 — GRANT hub_rw đúng R22/PL2, không hơn (int)", () => {
  test("ACL 3 bảng đúng nguyên tập (mức bảng + mức cột)", async () => {
    expect(await acl()).toEqual([
      "admin_rw:agent_grants:SELECT",
      "hub_rw:agent_grants:DELETE",
      "hub_rw:agent_grants:INSERT",
      "hub_rw:agent_grants:SELECT",
      "hub_rw:audit_log:INSERT",
      "hub_rw:audit_log:SELECT",
      "hub_rw:config_meta.hub_config_version:UPDATE",
      "hub_rw:config_meta:SELECT",
    ]);
  });

  test("hub_api INSERT/DELETE agent_grants được; UPDATE → 42501", async () => {
    const [g] = await api<{ id: string }[]>`insert into hub.agent_grants
      (agent_id, tenant_id, subject_type, subject_id) values (${AG}, ${T}, 'user', ${SUBJ}) returning id`;
    expect(g?.id).toBeTruthy();
    expect(
      await code(api`update hub.agent_grants set subject_type = 'group' where id = ${g?.id ?? ""}`),
    ).toBe("42501");
    const del =
      await api`delete from hub.agent_grants where id = ${g?.id ?? ""} and tenant_id = ${T}`;
    expect(del.count).toBe(1);
  });

  test("hub_api config_meta: FOR UPDATE + bump hub_config_version được; SET id → 42501", async () => {
    const [v] = await api.begin(async (tx) => {
      await tx`select hub_config_version from hub.config_meta where id = 1 for update`;
      return tx<
        { v: number }[]
      >`update hub.config_meta set hub_config_version = hub_config_version + 1
        where id = 1 returning hub_config_version as v`;
    });
    expect(v?.v).toBeGreaterThan(0);
    expect(await code(api`update hub.config_meta set id = 1 where id = 1`)).toBe("42501");
  });
});

describe("HUB-FR-78 · 0009 D1 — idempotent + áp trên DB đã có 0008 (int)", () => {
  test("lần 2 = {hub: 0, hubDev: 0}", async () => {
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });

  test("chạy lại toàn bộ câu của 0009 hai lần → không lỗi, không đổi; trigger không nhân đôi", async () => {
    const before = await snap();
    expect(before.filter((n) => n.startsWith("hub_audit_log_append_only")).length).toBe(2);
    for (const s of stmts) await owner.unsafe(s);
    for (const s of stmts) await owner.unsafe(s);
    expect(await snap()).toEqual(before);
  });

  test("DB đã có 0008 (gỡ phần 0009 + dòng journal) → áp 0009; dữ liệu cũ giữ", async () => {
    const before = await snap();
    await owner`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      values (${AG}, ${T}, 'group', ${SUBJ})`;
    await owner.unsafe(`drop table hub.audit_log; drop function hub.audit_log_append_only();
      drop index hub.usage_logs_run_idx;
      revoke insert, delete on hub.agent_grants from hub_rw;
      revoke update (hub_config_version) on hub.config_meta from hub_rw`);
    const removed = await rollbackJournalFrom(owner, 9);
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({
      hub: removed,
      hubDev: 0,
    });
    const [r] = await owner`select count(*)::int as n from hub.agent_grants
      where tenant_id = ${T} and subject_type = 'group' and subject_id = ${SUBJ}`;
    expect(r?.n).toBe(1);
    expect(await snap()).toEqual(before);
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });
});
