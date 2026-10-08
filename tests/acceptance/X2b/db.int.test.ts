// HUB-FR-101 · HUB-BR-22 · X2b-AC10, AC12, AC17 · test-plan X2b §5 (I70–I79): lưới DB của migration 0014 (plan §4.1, §4.2) —
// CHECK mới trên `room_messages`/`runs`, unique tin agent theo run, definer (`SECURITY DEFINER`, search_path cố định, không
// PUBLIC, scope `system` ⇒ 42501), policy insert `is_room_thread` (thành viên nhắn vào thread được; người ngoài / flow lạ /
// thread phòng khác bị từ chối), RLS không lộ tin + run phòng khác. Probe CHECK: owner (bỏ RLS). Probe RLS/definer: role
// `hub_api` + `SET LOCAL ROLE hub_rw` + GUC (như X2a RV2). Trước 0014: probe trả 42703/42883 ⇒ đỏ ở `expect`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { HUB_API_URL, R } from "../H1/_fixtures";
import { asUser, idGenX, mkGroup, pgCode, T } from "../X2a/_x2a";
import { AGB, answer, type CtxB, invoke, type Json, P, type Sql, settle, startX2b } from "./_x2b";

let c: CtxB;
let db: Sql;
const id = idGenX(80_000);
beforeAll(async () => {
  c = await startX2b();
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
}, 60_000);
afterEach(() => settle(c.sql));
afterAll(async () => {
  await db?.end();
  await c?.stop();
});

type Who = { id: string; tid: string };
/** Phòng nhóm lan + hoa (owner SQL, `last_seq` 100) + 1 tin user (làm `trigger_message_id`). */
async function seedRoom(): Promise<{ rid: string; trig: string; flow: string }> {
  const rid = id();
  const trig = id();
  await c.sql`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
    values (${rid}, ${T.acme}, 'group', 'Nhóm DB X2b', 100, now(), ${P.lan.id}, now())`;
  for (const [p, role] of [
    [P.lan, "owner"],
    [P.hoa, "member"],
  ] as const)
    await c.sql`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq)
      values (${rid}, ${T.acme}, ${p.id}, ${role}, now(), 0)`;
  await c.sql`insert into hub.room_messages (id, room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
    values (${trig}, ${rid}, ${T.acme}, 1, 'user', ${P.lan.id}, '@hoadon kiểm tra', now())`;
  const [r] = await c.sql<
    { flow_id: string }[]
  >`select flow_id from hub.runs where id = ${R.runLive}`;
  return { rid, trig, flow: r?.flow_id as string };
}
let seqN = 10;
/** INSERT owner một hàng `room_messages` (cột động) ⇒ mã PG ("ok" nếu được). */
const ins = (row: Json) =>
  pgCode(
    c.sql`insert into hub.room_messages ${c.sql({ tenant_id: T.acme, seq: seqN++, created_at: new Date(), content: "Tin", ...row })}`,
  );
const agentRow = (s: { rid: string; trig: string; flow: string }, over: Json = {}): Json => ({
  room_id: s.rid,
  sender_type: "agent",
  sender_id: AGB.hoadon,
  run_id: R.runLive,
  flow_id: s.flow,
  trigger_message_id: s.trig,
  run_status: "finished",
  placement: "main",
  ...over,
});
/** Chạy dưới role hub_rw + GUC `who` và COMMIT ⇒ mã PG. */
const asRw = (who: Who, fn: (tx: postgres.TransactionSql) => Promise<unknown>, scope = "user") =>
  pgCode(asUser(db, who, fn, { commit: true, scope }));
/** Thành viên gửi tin user vào phòng (seq qua `room_next_seq` như X2a), tuỳ chọn `flow_id`/`placement`. */
const sendRw = (who: Who, rid: string, extra: Json = {}) =>
  asRw(who, async (tx) => {
    const [s] = await tx`select hub.room_next_seq(${rid}) as s`;
    await tx`insert into hub.room_messages ${tx({
      room_id: rid,
      tenant_id: T.acme,
      seq: s?.s,
      sender_type: "user",
      sender_id: who.id,
      content: "Tin thread",
      created_at: new Date(),
      ...extra,
    })}`;
  });

describe("X2b · migration 0014 · CHECK room_messages / runs (plan §4.1)", () => {
  it("HUB-BR-22 · X2b-0014 · có room_messages_{user,agent,flow,ask}_ck + runs_room_posted_ck; bỏ room_messages_user_no_agent_ck", async () => {
    const rows = await c.sql<{ conname: string }[]>`select conname from pg_constraint
      where conrelid in ('hub.room_messages'::regclass, 'hub.runs'::regclass) and contype = 'c'`;
    const names = new Set(rows.map((r) => r.conname));
    expect({
      user: names.has("room_messages_user_ck"),
      agent: names.has("room_messages_agent_ck"),
      flow: names.has("room_messages_flow_ck"),
      ask: names.has("room_messages_ask_ck"),
      posted: names.has("runs_room_posted_ck"),
      old: names.has("room_messages_user_no_agent_ck"),
    }).toEqual({ user: true, agent: true, flow: true, ask: true, posted: true, old: false });
  });

  for (const col of ["sender_id", "run_id", "flow_id", "trigger_message_id", "run_status"] as const)
    it(`HUB-BR-22 · X2b-0014 · tin agent thiếu ${col} ⇒ 23514`, async () => {
      const s = await seedRoom();
      expect(await ins(agentRow(s, { [col]: null }))).toBe("23514");
    });

  it("HUB-BR-22 · X2b-0014 · tin agent đủ cột ⇒ ok; tin agent thứ hai cùng run_id ⇒ 23505 (room_messages_run_uq)", async () => {
    const s = await seedRoom();
    expect([await ins(agentRow(s)), await ins(agentRow(s))]).toEqual(["ok", "23505"]);
  });

  for (const [col, v] of [
    ["run_id", R.runLive],
    ["trigger_message_id", "<trig>"],
    ["run_status", "finished"],
    ["wait_kind", "need_input"],
    ["ask", { question: "?" }],
    ["step_count", 1],
    ["run_ms", 10],
  ] as const)
    it(`HUB-BR-22 · X2b-0014 · tin user có ${col} ⇒ 23514 (room_messages_user_ck)`, async () => {
      const s = await seedRoom();
      const val = v === "<trig>" ? s.trig : col === "ask" ? c.sql.json(v as Json) : v;
      const r = await ins({ room_id: s.rid, sender_type: "user", sender_id: P.hoa.id, [col]: val });
      expect(r).toBe("23514");
    });

  it("HUB-BR-22 · X2b-0014 · tin user có flow_id (tin người↔người trong thread) ⇒ ok ở mức CHECK", async () => {
    const s = await seedRoom();
    const r = await ins({
      room_id: s.rid,
      sender_type: "user",
      sender_id: P.hoa.id,
      flow_id: s.flow,
      placement: "flow",
    });
    expect(r).toBe("ok");
  });

  it("HUB-BR-22 · X2b-0014 · placement 'flow' không flow_id ⇒ 23514; placement 'x' ⇒ 23514", async () => {
    const s = await seedRoom();
    const u = { room_id: s.rid, sender_type: "user", sender_id: P.hoa.id };
    expect([await ins({ ...u, placement: "flow" }), await ins({ ...u, placement: "x" })]).toEqual([
      "23514",
      "23514",
    ]);
  });

  it("HUB-BR-22 · X2b-0014 · ask khi wait_kind side_effect ⇒ 23514; run_status / wait_kind lạ, step_count âm ⇒ 23514", async () => {
    const s = await seedRoom();
    const bad = [
      { wait_kind: "side_effect", ask: c.sql.json({ question: "PARAM?" }) },
      { run_status: "running" },
      { wait_kind: "other" },
      { step_count: -1 },
    ];
    const out: string[] = [];
    for (const b of bad) out.push(await ins(agentRow(s, { ...b, run_id: R.runLive })));
    expect(out).toEqual(["23514", "23514", "23514", "23514"]);
  });

  it("HUB-BR-22 · X2b-0014 · runs.room_posted_at khi room_id NULL ⇒ 23514 (runs_room_posted_ck)", async () => {
    const r = await pgCode(
      c.sql`update hub.runs set room_posted_at = now() where id = ${R.runLive}`,
    );
    expect(r).toBe("23514");
  });
});

describe("X2b · definer 0014 (plan §4.2, §11)", () => {
  const FNS = ["is_room_thread", "room_fanout_sys", "room_post_agent_message", "room_run_states"];

  it("HUB-BR-22 · X2b-0014 · 4 hàm SECURITY DEFINER, search_path cố định, hub_rw EXECUTE, không PUBLIC", async () => {
    const rows = await c.sql<Json[]>`select p.proname as name, p.prosecdef as definer,
        coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%' as path,
        has_function_privilege('hub_rw', p.oid, 'EXECUTE') as rw,
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'hub' and p.proname = any(${FNS}) order by p.proname`;
    expect([...rows] as Json[]).toEqual(
      FNS.map((name) => ({ name, definer: true, path: true, rw: true, public: false })),
    );
  });

  it("HUB-BR-22 · X2b-0014 · room_post_agent_message / room_fanout_sys gọi ở scope user ⇒ 42501", async () => {
    const s = await seedRoom();
    const post = await asRw(
      P.lan,
      (tx) =>
        tx`select * from hub.room_post_agent_message(${R.runLive}::uuid, ${AGB.hoadon}::uuid, 'X', '{}'::jsonb)`,
    );
    const fan = await asRw(P.lan, (tx) => tx`select * from hub.room_fanout_sys(${s.rid}::uuid)`);
    expect({ post, fan }).toEqual({ post: "42501", fan: "42501" });
  });

  it("HUB-BR-22 · X2b-0014 · is_room_thread(phòng, flow ngẫu nhiên / flow riêng không phải thread) ⇒ false", async () => {
    const s = await seedRoom();
    const vals: unknown[] = [];
    const r = await asRw(P.hoa, async (tx) => {
      for (const f of [id(), s.flow]) {
        const [x] = await tx`select hub.is_room_thread(${s.rid}::uuid, ${f}::uuid) as ok`;
        vals.push(x?.ok);
      }
    });
    expect({ r, vals }).toEqual({ r: "ok", vals: [false, false] });
  });
});

describe("X2b · policy insert is_room_thread + RLS (AC10, AC17, §4.2)", () => {
  /** lan mở thread trong nhóm (lan, hoa, tam) qua API; trả phòng + thread. */
  async function thread(name: string) {
    const room = (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.tam.id], name))
      .id as string;
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    await answer(c, s.runId, "HD-12 hợp lệ.");
    return { room, flow: s.flowId as string, runId: s.runId };
  }

  it("HUB-FR-101 · X2b-AC17 · thành viên (hoa, không quyền hoadon) chèn tin user vào thread của phòng ⇒ ok; is_room_thread = true", async () => {
    const t = await thread("Nhóm DB thread");
    const r = await sendRw(P.hoa, t.room, { flow_id: t.flow, placement: "flow" });
    const vals: unknown[] = [];
    await asRw(P.hoa, async (tx) => {
      const [x] = await tx`select hub.is_room_thread(${t.room}::uuid, ${t.flow}::uuid) as ok`;
      vals.push(x?.ok);
    });
    expect({ r, vals }).toEqual({ r: "ok", vals: [true] });
  });

  it("HUB-BR-22 · X2b-AC10 · người ngoài phòng (cuc) chèn tin vào thread ⇒ bị từ chối, không có hàng", async () => {
    const t = await thread("Nhóm DB ngoài");
    const r = await sendRw(P.cuc, t.room, { flow_id: t.flow });
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.room_messages where room_id = ${t.room} and sender_id = ${P.cuc.id}`;
    expect({ rejected: r !== "ok", n: n?.n }).toEqual({ rejected: true, n: 0 });
  });

  it("HUB-BR-22 · X2b-AC10 · flow_id ngẫu nhiên / flow riêng H1 (không phải thread) ⇒ bị từ chối (hồi quy RV2-N2c)", async () => {
    const room = (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id], "Nhóm DB flow lạ"))
      .id as string;
    const out = [
      await sendRw(P.hoa, room, { flow_id: id() }),
      await sendRw(P.lan, room, { flow_id: R.flow2 }),
    ];
    expect(out.map((x) => x !== "ok")).toEqual([true, true]);
  });

  it("HUB-BR-22 · X2b-AC10 · thread của phòng khác (hoa là thành viên cả hai) ⇒ bị từ chối", async () => {
    const t = await thread("Nhóm DB thread 1");
    const other = (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id], "Nhóm DB thread 2"))
      .id as string;
    const r = await sendRw(P.hoa, other, { flow_id: t.flow, placement: "flow" });
    expect(r).not.toBe("ok");
  });

  it("HUB-BR-22 · X2b-AC10 · RLS: cuc (ngoài phòng) không thấy tin agent / run; tam (thành viên) thấy tin agent nhưng không thấy run của lan", async () => {
    const t = await thread("Nhóm DB RLS");
    const look = async (who: Who) => {
      let v: Json = {};
      await asUser(db, who, async (tx) => {
        const [m] =
          await tx`select count(*)::int as n from hub.room_messages where run_id = ${t.runId}`;
        const [a] =
          await tx`select count(*)::int as n from hub.room_messages where room_id = ${t.room}`;
        const [r] = await tx`select count(*)::int as n from hub.runs where id = ${t.runId}`;
        v = { agent: m?.n, room: a?.n, run: r?.n };
      });
      return v;
    };
    const [cuc, tam] = [await look(P.cuc), await look(P.tam)];
    expect({ cuc, tamAgent: tam.agent, tamRun: tam.run }).toEqual({
      cuc: { agent: 0, room: 0, run: 0 },
      tamAgent: 1,
      tamRun: 0,
    });
  });
});
