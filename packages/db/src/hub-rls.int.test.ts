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
    for (const t of TABLES)
      expect(await code(rt.unsafe(`select count(*) from hub.${t}`))).toBe("42501");
    expect(await code(rt`select count(*) from admin.users`)).toBe("42501");
  });

  test("HUB-FR-75 · RLS bật trên đúng 5 bảng hội thoại (+ tool_confirmations H2a), policy chỉ cho hub_rw", async () => {
    const rows = await owner<{ t: string; roles: string }[]>`
      select c.relname as t, array_to_string(p.polroles::regrole[], ',') as roles
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'hub' and c.relrowsecurity order by 1`;
    expect([...rows]).toEqual(
      [...TABLES, "tool_confirmations"].sort().map((t) => ({ t, roles: "hub_rw" })),
    );
  });
});
