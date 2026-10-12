// HUB-FR-44 · HUB-FR-101 · HUB-BR-22 · migration 0023_x2b2_room_attachments (plan X2b-2 §1 D2–D6, §4): cột phòng của
// `hub.attachments`, FK kép cùng tenant/cùng phòng, CHECK "một nơi", RLS (chủ + thành viên hiện tại), definer sweeper
// phòng xoá (scope system), chạy lại 2 lần không đổi. DB Hub riêng (HUB_TEST_DATABASE_URL). Dữ liệu giả.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

const T1 = "01900000-0000-7000-8000-0000002b2a01";
const T2 = "01900000-0000-7000-8000-0000002b2a02";
const A = "01900000-0000-7000-8000-0000002b2b01"; // chủ file, thành viên G1
const B = "01900000-0000-7000-8000-0000002b2b02"; // thành viên G1
const C = "01900000-0000-7000-8000-0000002b2b03"; // ngoài G1
const SHA = "b".repeat(64);
const g = { g1: "", g2: "", t2: "", m1: "", m2: "", conv: "", flow: "", msg: "" };
const user = (userId: string, tenantId = T1): HubScope => ({ kind: "user", tenantId, userId });

/** Mã lỗi + ràng buộc (`23514:attachments_room_msg_ck`); thành công = "ok". */
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (err: {
      code?: string;
      constraint_name?: string;
      cause?: { code?: string; constraint_name?: string };
    }) => {
      const e = err.code ? err : (err.cause ?? err);
      return e.constraint_name ? `${e.code}:${e.constraint_name}` : (e.code ?? String(err));
    },
  );

type Att = Record<string, string | number | Date | null>;
async function insert(over: Att = {}): Promise<string> {
  const id = (over.id as string | undefined) ?? crypto.randomUUID();
  const tenant = (over.tenant_id as string | undefined) ?? T1;
  const row: Att = {
    id,
    tenant_id: tenant,
    user_id: A,
    origin: "upload",
    filename: "hoa-don.pdf",
    safe_name: "hoa-don.pdf",
    mime: "application/pdf",
    size: 10,
    sha256: SHA,
    storage_key: `${tenant}/${id}`,
    ...over,
  };
  await owner`insert into hub.attachments ${owner(row)}`;
  return id;
}
const inRoom = (room: string, msg: string | null, position = 0): Att => ({
  room_id: room,
  room_message_id: msg,
  bound_at: new Date(),
  position,
});

async function room(tenant: string, by: string, members: string[]): Promise<string> {
  const id = crypto.randomUUID();
  await owner`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
    values (${id}, ${tenant}, 'group', 'Phòng 0023', 0, now(), ${by}, now())`;
  for (const [i, u] of members.entries())
    await owner`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at)
      values (${id}, ${tenant}, ${u}, ${i === 0 ? "owner" : "member"}, now())`;
  return id;
}
let seq = 0;
async function roomMsg(r: string, tenant = T1): Promise<string> {
  seq += 1;
  const [m] = await owner<{ id: string }[]>`insert into hub.room_messages
    (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
    values (${r}, ${tenant}, ${seq}, 'user', ${A}, 'tin', now()) returning id`;
  return m?.id ?? "";
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  g.g1 = await room(T1, A, [A, B]);
  g.g2 = await room(T1, A, [A, C]);
  g.t2 = await room(T2, A, [A]);
  g.m1 = await roomMsg(g.g1);
  g.m2 = await roomMsg(g.g2);
  const [c] = await owner<{ id: string }[]>`insert into hub.conversations
    (tenant_id, user_id, title, title_norm) values (${T1}, ${A}, 'c', 'c') returning id`;
  g.conv = c?.id ?? "";
  const [f] = await owner<{ id: string }[]>`insert into hub.flows
    (tenant_id, user_id, conversation_id, title) values (${T1}, ${A}, ${g.conv}, 'f') returning id`;
  g.flow = f?.id ?? "";
  const [m] = await owner<{ id: string }[]>`insert into hub.messages
    (tenant_id, user_id, conversation_id, flow_id, role, content)
    values (${T1}, ${A}, ${g.conv}, ${g.flow}, 'user', 'hi') returning id`;
  g.msg = m?.id ?? "";
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("HUB-BR-22 · 0023 D4 — FK kép, CHECK (int)", () => {
  test("file phòng hợp lệ (room_id + room_message_id cùng phòng) → ok; chưa có tin (room_message_id NULL) → ok", async () => {
    expect(await code(insert(inRoom(g.g1, g.m1)))).toBe("ok");
    expect(await code(insert(inRoom(g.g1, null, 9)))).toBe("ok");
  });

  test("phòng tenant khác → 23503 attachments_room_fk; tin phòng khác → 23503 attachments_room_message_fk", async () => {
    expect(await code(insert(inRoom(g.t2, null)))).toBe("23503:attachments_room_fk");
    expect(await code(insert(inRoom(g.g1, g.m2)))).toBe("23503:attachments_room_message_fk");
  });

  test("một nơi: room_id + message/conversation/flow, thiếu bound_at/position, position 10 → 23514 attachments_room_bound_ck", async () => {
    const both = {
      ...inRoom(g.g1, g.m1),
      message_id: g.msg,
      conversation_id: g.conv,
      flow_id: g.flow,
    };
    expect(await code(insert(both))).toBe("23514:attachments_room_bound_ck");
    expect(await code(insert({ ...inRoom(g.g1, null), conversation_id: g.conv }))).toBe(
      "23514:attachments_room_bound_ck",
    );
    expect(await code(insert({ ...inRoom(g.g1, null), bound_at: null }))).toBe(
      "23514:attachments_room_bound_ck",
    );
    expect(await code(insert({ ...inRoom(g.g1, null), position: null }))).toBe(
      "23514:attachments_room_bound_ck",
    );
    expect(await code(insert(inRoom(g.g1, null, 10)))).toBe("23514:attachments_room_bound_ck");
  });

  test("room_message_id không room_id → 23514 attachments_room_msg_ck", async () => {
    expect(await code(insert({ room_message_id: g.m1, bound_at: new Date(), position: 0 }))).toBe(
      "23514:attachments_room_msg_ck",
    );
  });

  test("xoá cứng tin phòng → chỉ room_message_id về NULL, room_id giữ (không thành 'chưa gắn')", async () => {
    const m = await roomMsg(g.g1);
    const id = await insert(inRoom(g.g1, m, 1));
    await owner`delete from hub.room_messages where id = ${m}`;
    const [r] = await owner<
      { room_id: string; room_message_id: string | null }[]
    >`select room_id, room_message_id from hub.attachments where id = ${id}`;
    expect(r).toEqual({ room_id: g.g1, room_message_id: null });
  });
});

describe("HUB-FR-44 · 0023 D5 — RLS ma trận đọc/ghi (int)", () => {
  const ids = { own: "", room: "", other: "", t2: "" };
  let lit = "";
  const seen = (scope: HubScope) =>
    withHubScope(db, scope, async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        dsql`select id from hub.attachments where id = any(${lit}::uuid[])`,
      );
      const upd = await tx.execute<{ id: string }>(
        dsql`update hub.attachments set filename = filename where id = any(${lit}::uuid[]) returning id`,
      );
      return { read: [...rows].map((r) => r.id).sort(), wrote: [...upd].map((r) => r.id).sort() };
    });
  const sorted = (...xs: string[]) => [...xs].sort();

  beforeAll(async () => {
    ids.own = await insert(); // A, chưa gắn
    ids.room = await insert(inRoom(g.g1, g.m1, 2)); // A, gắn G1
    ids.other = await insert({ ...inRoom(g.g1, null, 3), user_id: B }); // B, gắn G1
    ids.t2 = await insert({ ...inRoom(g.t2, null), tenant_id: T2 }); // T2
    lit = `{${Object.values(ids).join(",")}}`;
  });

  test("A (chủ, thành viên): đọc own+room+other; ghi own+room", async () => {
    expect(await seen(user(A))).toEqual({
      read: sorted(ids.own, ids.room, ids.other),
      wrote: sorted(ids.own, ids.room),
    });
  });

  test("B (thành viên, không phải chủ file A): đọc room+other; ghi chỉ other", async () => {
    expect(await seen(user(B))).toEqual({
      read: sorted(ids.room, ids.other),
      wrote: [ids.other],
    });
  });

  test("C (ngoài G1) và tenant khác → không thấy, không ghi; system thấy hết", async () => {
    expect(await seen(user(C))).toEqual({ read: [], wrote: [] });
    expect(await seen(user(A, T2))).toEqual({ read: [ids.t2], wrote: [ids.t2] });
    expect(await seen(user(B, T2))).toEqual({ read: [], wrote: [] });
    const all = sorted(...Object.values(ids));
    expect(await seen({ kind: "system" })).toEqual({ read: all, wrote: all });
  });

  test("A rời G1 → mất cả file phòng của chính mình (R05), vẫn thấy file chưa gắn; vào lại → thấy lại", async () => {
    await owner`update hub.room_members set left_at = now() where room_id = ${g.g1} and user_id = ${A}`;
    try {
      expect(await seen(user(A))).toEqual({ read: [ids.own], wrote: [ids.own] });
    } finally {
      await owner`update hub.room_members set left_at = null where room_id = ${g.g1} and user_id = ${A}`;
    }
    expect((await seen(user(A))).read).toContain(ids.room);
  });

  test("WITH CHECK: chủ không phải thành viên gắn file vào phòng → 42501; thành viên gắn được", async () => {
    const free = await insert();
    const bind = (who: string, r: string) =>
      code(
        withHubScope(db, user(who), (tx) =>
          tx.execute(dsql`update hub.attachments set room_id = ${r}, bound_at = now(), position = 0
            where id = ${free}`),
        ),
      );
    expect(await bind(A, g.t2)).toBe("42501"); // phòng tenant khác: không là thành viên ở scope T1
    await owner`update hub.attachments set user_id = ${C} where id = ${free}`;
    expect(await bind(C, g.g1)).toBe("42501");
    expect(await bind(C, g.g2)).toBe("ok");
  });

  test("scope lạ/rỗng → 0 hàng", async () => {
    const raw = (scope: string) =>
      db.db.transaction(async (tx) => {
        await tx.execute(dsql`select set_config('app.scope', ${scope}, true),
          set_config('app.tenant_id', ${T1}, true), set_config('app.user_id', ${A}, true)`);
        return [
          ...(await tx.execute(
            dsql`select id from hub.attachments where id = any(${lit}::uuid[])`,
          )),
        ].length;
      });
    expect(await raw("admin")).toBe(0);
    expect(await raw("")).toBe(0);
  });
});

describe("HUB-FR-44 · 0023 D6 — hub.attach_claim_deleted_rooms (int)", () => {
  const claim = (scope: HubScope, limit = 10) =>
    withHubScope(db, scope, async (tx) => [
      ...(await tx.execute<{ id: string; storage_key: string }>(
        dsql`select * from hub.attach_claim_deleted_rooms(now(), ${limit})`,
      )),
    ]);

  test("scope user → 42501", async () => {
    expect(await code(claim(user(A)))).toBe("42501");
  });

  test("system: chỉ file sống của phòng đã xoá, đặt purged_at, trả storage_key; lần 2 → rỗng; limit tôn trọng", async () => {
    const dead = await room(T1, A, [A]);
    const f1 = await insert(inRoom(dead, null, 0));
    const f2 = await insert(inRoom(dead, null, 1));
    await insert({ ...inRoom(dead, null, 2), purged_at: new Date() });
    await owner`update hub.rooms set deleted_at = now() where id = ${dead}`;
    const first = await claim({ kind: "system" }, 1);
    expect(first.length).toBe(1);
    const rest = await claim({ kind: "system" });
    const got = [...first, ...rest].map((r) => r.id).sort();
    expect(got).toEqual([f1, f2].sort());
    expect(first[0]?.storage_key).toBe(`${T1}/${first[0]?.id}`);
    const [n] = await owner<{ n: number }[]>`select count(*)::int as n from hub.attachments
      where room_id = ${dead} and purged_at is null`;
    expect(n?.n).toBe(0);
    expect(await claim({ kind: "system" })).toEqual([]);
  });

  test("agent_runtime/PUBLIC không có EXECUTE", async () => {
    const [r] = await owner<{ rt: boolean; pub: boolean }[]>`select
      has_function_privilege('agent_runtime', 'hub.attach_claim_deleted_rooms(timestamptz, integer)', 'EXECUTE') as rt,
      has_function_privilege('public', 'hub.attach_claim_deleted_rooms(timestamptz, integer)', 'EXECUTE') as pub`;
    expect(r).toEqual({ rt: false, pub: false });
  });
});

/** Người dùng `u` (scope user) đọc được hàng attachment `id` không (RLS lớp 2). */
const visibleTo = (u: string, id: string) =>
  withHubScope(db, user(u), async (tx) => {
    const rows = await tx.execute<{ id: string }>(
      dsql`select id from hub.attachments where id = ${id}`,
    );
    return rows.length === 1;
  });

describe("HUB-FR-101 · 0026 RV1 #1 — out/ của tin agent chờ side_effect chỉ người gọi (int)", () => {
  const s = { run: "", file: "" };
  const confirm = (status: string) =>
    owner`update hub.tool_confirmations set status = ${status}, decided_run_id = ${s.run} where run_id = ${s.run}`;
  const visible = (u: string) => visibleTo(u, s.file);

  beforeAll(async () => {
    const [r] = await owner<
      { id: string }[]
    >`insert into hub.runs (tenant_id, user_id, conversation_id,
      flow_id, status, config_version, user_message_id, answer_message_id, finished_at)
      values (${T1}, ${A}, ${g.conv}, ${g.flow}, 'finished', 1, ${crypto.randomUUID()}, ${crypto.randomUUID()}, now())
      returning id`;
    s.run = r?.id ?? "";
    seq += 1;
    const [m] = await owner<{ id: string }[]>`insert into hub.room_messages
      (room_id, tenant_id, seq, sender_type, sender_id, content, created_at, run_id, flow_id, trigger_message_id,
       run_status, wait_kind)
      values (${g.g1}, ${T1}, ${seq}, 'agent', ${crypto.randomUUID()}, 'chung', now(), ${s.run}, ${g.flow}, ${g.m1},
       'finished', 'side_effect') returning id`;
    await owner`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
      values (${T1}, ${A}, ${g.flow}, ${s.run}, ${crypto.randomUUID()}, ${crypto.randomUUID()}, 'pending')`;
    s.file = await insert(inRoom(g.g1, m?.id ?? null, 4)); // origin upload: luật không phụ thuộc origin
  });

  test("pending ⇒ A (người gọi, chủ file) thấy, B (thành viên) không; definer đúng mẫu", async () => {
    expect(await visible(A)).toBe(true);
    expect(await visible(B)).toBe(false);
    const [f] = await owner<
      { def: boolean; pub: boolean; rw: boolean }[]
    >`select p.prosecdef as def,
        has_function_privilege('public', p.oid, 'EXECUTE') as pub, has_function_privilege('hub_rw', p.oid, 'EXECUTE') as rw
      from pg_proc p where p.pronamespace = 'hub'::regnamespace and p.proname = 'room_msg_withheld'`;
    expect(f).toEqual({ def: true, pub: false, rw: true });
  });

  test("hết pending (confirmed/declined) ⇒ B thấy (R11 bình thường)", async () => {
    await confirm("confirmed");
    expect(await visible(B)).toBe(true);
    await confirm("pending");
    expect(await visible(B)).toBe(false);
    await confirm("declined");
    expect(await visible(B)).toBe(true);
  });
});

describe("HUB-FR-44 · 0023 — idempotent (int)", () => {
  const file = new URL("../migrations-hub/0023_x2b2_room_attachments.sql", import.meta.url);
  const stmts = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const snap = async () =>
    (
      await owner<
        { n: string }[]
      >`select conname || ':' || pg_get_constraintdef(oid) as n from pg_constraint
        where conrelid in ('hub.attachments'::regclass, 'hub.room_messages'::regclass)
        union all select indexname || ':' || indexdef from pg_indexes where schemaname = 'hub'
        union all select policyname || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
          from pg_policies where schemaname = 'hub'
        union all select 'fn:' || p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proacl, ','), '')
          from pg_proc p where p.pronamespace = 'hub'::regnamespace and p.proname = 'attach_claim_deleted_rooms'
        order by 1`
    ).map((r) => r.n);

  test("chạy lại toàn bộ câu của 0023 hai lần → không lỗi, ràng buộc/index/policy/hàm không đổi", async () => {
    const before = await snap();
    for (const s of stmts) await owner.unsafe(s);
    for (const s of stmts) await owner.unsafe(s);
    expect(await snap()).toEqual(before);
    expect(before.some((n) => n.startsWith("fn:attach_claim_deleted_rooms:true:"))).toBe(true);
  });
});
