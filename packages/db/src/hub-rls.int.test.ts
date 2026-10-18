// HUB-FR-75 · HUB-BR-14 · RLS 5 bảng hội thoại + withHubScope trên role hub_api (plan H1 §3.4). qc có A6 riêng.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
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
const rt = postgres(asRole("agent_runtime", "agent_runtime_dev_pw"), {
  max: 1,
  onnotice: () => {},
});

const T1 = "01900000-0000-7000-8000-0000000d2a01";
const T2 = "01900000-0000-7000-8000-0000000d2a02";
const U1 = "01900000-0000-7000-8000-0000000d2b01";
const U2 = "01900000-0000-7000-8000-0000000d2b02";
const U3 = "01900000-0000-7000-8000-0000000d2b03";
const OWNERS = [
  [T1, U1],
  [T1, U2],
  [T2, U3],
] as const;
const TABLES = ["conversations", "flows", "messages", "runs", "run_steps"] as const;
const lan: HubScope = { kind: "user", tenantId: T1, userId: U1 };

/** Mỗi (tenant, user) một chuỗi hội thoại → flow → tin → run → bước, ghi bằng owner (bỏ qua RLS). */
async function seedChain(tid: string, uid: string): Promise<void> {
  const [c] = await owner<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  const [f] = await owner<
    { id: string }[]
  >`insert into hub.flows (tenant_id, user_id, conversation_id, title)
    values (${tid}, ${uid}, ${c?.id ?? ""}, 'f') returning id`;
  const [m] = await owner<{ id: string }[]>`insert into hub.messages
    (tenant_id, user_id, conversation_id, flow_id, role, content)
    values (${tid}, ${uid}, ${c?.id ?? ""}, ${f?.id ?? ""}, 'user', 'hi') returning id`;
  const [r] = await owner<{ id: string }[]>`insert into hub.runs
    (tenant_id, user_id, conversation_id, flow_id, status, config_version, user_message_id, answer_message_id)
    values (${tid}, ${uid}, ${c?.id ?? ""}, ${f?.id ?? ""}, 'running', '1', ${m?.id ?? ""}, ${crypto.randomUUID()})
    returning id`;
  await owner`insert into hub.run_steps (tenant_id, user_id, run_id, seq, type, label_key, status)
    values (${tid}, ${uid}, ${r?.id ?? ""}, 1, 'orchestrator', 'k', 'running')`;
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  for (const [tid, uid] of OWNERS) await seedChain(tid, uid);
});
afterAll(async () => {
  await db.close();
  await rt.end();
  await owner.end();
});

type Row = { tenant_id: string; user_id: string };
/** Cặp (tenant, user) thấy được ở từng bảng, trong một withHubScope. */
const seenOwners = (scope: HubScope) =>
  withHubScope(db, scope, async (tx) => {
    const out: Record<string, string[]> = {};
    for (const t of TABLES) {
      const rows = (await tx.execute(
        dsql`select tenant_id, user_id from ${dsql.raw(`hub.${t}`)} order by 1, 2`,
      )) as unknown as Row[];
      out[t] = rows.map((r) => `${r.tenant_id}/${r.user_id}`);
    }
    return out;
  });
const everyTable = (v: string[]) => Object.fromEntries(TABLES.map((t) => [t, v]));

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code ?? String(e),
  );

describe("HUB-FR-75 · RLS hội thoại hub_rw (int)", () => {
  test("HUB-FR-75 · scope user chỉ thấy đúng (tenant, user); system thấy hết", async () => {
    expect(await seenOwners(lan)).toEqual(everyTable([`${T1}/${U1}`]));
    expect(await seenOwners({ kind: "user", tenantId: T2, userId: U3 })).toEqual(
      everyTable([`${T2}/${U3}`]),
    );
    // user đúng nhưng tenant sai → 0 dòng.
    expect(await seenOwners({ kind: "user", tenantId: T2, userId: U1 })).toEqual(everyTable([]));
    const all = OWNERS.map(([t, u]) => `${t}/${u}`).sort();
    expect(await seenOwners({ kind: "system" })).toEqual(everyTable(all));
  });

  test("HUB-FR-75 · không scope (ngoài withHubScope) → 0 dòng; scope không rò sau transaction", async () => {
    await seenOwners(lan);
    const [r] = (await db.db.execute(
      dsql`select count(*)::int as n, current_setting('app.scope', true) as s from hub.conversations`,
    )) as unknown as { n: number; s: string | null }[];
    expect(r?.n).toBe(0);
    expect(r?.s ?? "").toBe("");
  });

  test("HUB-BR-14 · ghi dòng tenant/user khác hoặc chuyển chủ → 42501", async () => {
    const ins = withHubScope(db, lan, (tx) =>
      tx.execute(dsql`insert into hub.conversations (tenant_id, user_id, title, title_norm)
        values (${T2}, ${U3}, 'x', 'x')`),
    );
    expect(await code(ins)).toBe("42501");
    const move = withHubScope(db, lan, (tx) =>
      tx.execute(dsql`update hub.conversations set user_id = ${U2}`),
    );
    expect(await code(move)).toBe("42501");
    const own = withHubScope(db, lan, (tx) =>
      tx.execute(dsql`insert into hub.conversations (tenant_id, user_id, title, title_norm)
        values (${T1}, ${U1}, 'y', 'y') returning id`),
    );
    expect(await code(own)).toBe("ok");
  });
});

/** X2a (0011): mỗi phần tử = một policy (rooms 2, room_members 3, room_messages 2); CR-050 (0017): room_flow_reads 3. */
const X2A_POLICY_TABLES = [
  ...Array(2).fill("rooms"),
  ...Array(3).fill("room_members"),
  ...Array(2).fill("room_messages"),
  ...Array(3).fill("room_flow_reads"),
];
/** P-a (0019): 6 bảng run 1 policy T; process_defs 4 (đọc + ghi system); notices 3; outbox 3; P-d1 (0036) process_timers 1. */
const PA_POLICY_TABLES = [
  ...["process_runs", "stage_runs", "team_runs", "process_outputs", "review_tasks"],
  "review_task_assignees",
  ...Array(4).fill("process_defs"),
  ...Array(3).fill("process_notices"),
  ...Array(3).fill("process_thread_events"),
  // P-b2 (0024): nhật ký quay lại append-only — 1 policy T.
  "process_back_events",
  // P-c1 (0031): kết quả tự-sửa append-only — 1 policy T.
  "autofix_results",
  // P-c2 (0032): kết quả Áp — 1 policy T (UPDATE theo cột, C6).
  "autofix_applies",
  // P-d1 (0036): hẹn giờ bền — 1 policy T (readiness #89).
  "process_timers",
];
/** Bảng RLS thêm sau H1 ngoài P-a (danh sách cũ chưa cập nhật — sửa cùng T6 P-d1): P-b 0021 (sources, source_job_reads),
 * X2b2 0023 (attachments thêm policy room_member_select), H4b-1 0028 (secrets), K1 0029 (kh_jobs, kh_stage_usage,
 * kh_writes) — mỗi cái 1 policy hub_rw. `runs_agent_runtime_select` (0022) kiểm riêng ở RUNTIME_POLICIES. */
const LATER_POLICY_TABLES = [
  "sources",
  "source_job_reads",
  "attachments",
  "secrets",
  "kh_jobs",
  "kh_stage_usage",
  "kh_writes",
];
/** 0022 (B4 · WRK-FR-27): agent_runtime đọc `hub.runs` cột (id, status), chỉ hàng `running`. */
const RUNTIME_POLICIES = [{ t: "runs", roles: "agent_runtime" }];

describe("HUB-FR-75 · withHubScope thử lại, quyền role, policy (int)", () => {
  test("HUB-FR-75 · withHubScope chạy lại khi 40001, không chạy lại lỗi khác", async () => {
    let n = 0;
    const out = await withHubScope(db, lan, async () => {
      n++;
      if (n === 1) throw Object.assign(new Error("serialization"), { code: "40001" });
      return "ok";
    });
    expect([out, n]).toEqual(["ok", 2]);
    let m = 0;
    const bad = withHubScope(db, lan, async () => {
      m++;
      throw Object.assign(new Error("x"), { code: "23505" });
    });
    expect(await code(bad)).toBe("23505");
    expect(m).toBe(1);
  });

  test("WRK-FR-24 · agent_runtime không đọc bảng hội thoại / admin.*", async () => {
    // `runs`: 0022 cấp SELECT (id, status) + policy hàng `running` cho agent_runtime (WRK-FR-27) — cột khác vẫn 42501.
    for (const t of TABLES.filter((x) => x !== "runs"))
      expect(await code(rt.unsafe(`select count(*) from hub.${t}`))).toBe("42501");
    expect(await code(rt`select tenant_id from hub.runs`)).toBe("42501");
    expect(await code(rt`select count(*) from admin.users`)).toBe("42501");
  });

  test("HUB-FR-75 · HUB-FR-96 · RLS bật trên đúng 5 bảng hội thoại (+ tool_confirmations H2a, attachments H2c, 3 bảng phòng X2a: 7 policy), policy chỉ cho hub_rw", async () => {
    const rows = await owner<{ t: string; roles: string }[]>`
      select c.relname as t, array_to_string(p.polroles::regrole[], ',') as roles
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'hub' and c.relrowsecurity order by 1`;
    const hubRw = [
      ...TABLES,
      "tool_confirmations",
      "attachments",
      ...X2A_POLICY_TABLES,
      ...PA_POLICY_TABLES,
      ...LATER_POLICY_TABLES,
    ].map((t) => ({ t, roles: "hub_rw" }));
    const key = (r: { t: string; roles: string }) => `${r.t}|${r.roles}`;
    expect([...rows].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      [...hubRw, ...RUNTIME_POLICIES].sort((a, b) => key(a).localeCompare(key(b))),
    );
  });
});
