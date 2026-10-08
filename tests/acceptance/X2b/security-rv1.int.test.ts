// HUB-FR-101 · HUB-FR-95 · HUB-BR-21 · HUB-BR-22 · X2b-R17 · Q8 · D2 · D15 · test khoá cho security review vòng 1
// (`review-security-1.md` Minor #1–#6, test-plan-rv1.md). Lưới DB: role `hub_api` + `SET LOCAL ROLE hub_rw` + GUC như
// `withHubScope` (`asUser` X2a). Kiểm HÀNH VI (trạng thái DB / HTTP sau thao tác), không phụ thuộc tên hàm nội bộ.
// S1: chủ run sửa cột `runs` của mình ở scope user rồi để vòng đăng tin (reconcile 5 s, scope system) chạy.
// S4: gọi thẳng `room_post_agent_message` ở scope system với `sender` giả (chữ ký 4 tham số hiện tại; bỏ tham số ⇒ 42883 = bị từ chối).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { HUB_API_URL, R } from "../H1/_fixtures";
import { api, asUser, mkGroup, pgCode } from "../X2a/_x2a";
import {
  AGB,
  answer,
  type CtxB,
  idGenB,
  invoke,
  type Json,
  P,
  post,
  roomRuns,
  type Sql,
  settle,
  startX2b,
  waitAgentMsg,
  waitFor,
} from "./_x2b";

let c: CtxB;
let db: Sql;
const id = idGenB(70_000);
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
/** Chạy dưới role hub_rw + GUC `who` (scope tuỳ chọn) và COMMIT ⇒ mã PG ("ok"). */
const asRw = (who: Who, fn: (tx: postgres.TransactionSql) => Promise<unknown>, scope = "user") =>
  pgCode(asUser(db, who, fn, { commit: true, scope }));
const group = async (owner: "lan" | "hoa", members: string[], name: string) =>
  (await mkGroup(c.hub, await c.tok(owner), members, name)).id as string;
const runRow = async (runId: string) =>
  (
    await c.sql<Json[]>`select r.status, r.flow_id, r.conversation_id, r.room_posted_at
      from hub.runs r where r.id = ${runId}`
  )[0] ?? {};
const agentRowsOf = (runId: string) =>
  c.sql<Json[]>`select id, room_id, flow_id, sender_id, content from hub.room_messages
    where run_id = ${runId} and sender_type = 'agent'`;
/** Tin C1 riêng (assistant) của người khác — owner SQL, hội thoại + flow riêng. */
async function privateMsg(p: Who, secret: string, conv?: string, flow?: string): Promise<string> {
  const cid = conv ?? id();
  const fid = flow ?? id();
  if (!conv)
    await c.sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
      values (${cid}, ${p.tid}, ${p.id}, 'Riêng', 'rieng')`;
  if (!flow)
    await c.sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
      values (${fid}, ${p.tid}, ${p.id}, ${cid}, 'Riêng', 1)`;
  const mid = id();
  await c.sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id)
    values (${mid}, ${p.tid}, ${p.id}, ${cid}, ${fid}, 'assistant', ${secret}, null)`;
  return mid;
}
/** Chờ vòng đăng tin xử lý run (đánh dấu `room_posted_at` hoặc có tin agent) — tối đa `ms` (reconcile 5 s). */
const posted = (runId: string, ms = 9_000) =>
  waitFor(
    async () => ({ run: await runRow(runId), rows: await agentRowsOf(runId) }),
    (v) => v.run.room_posted_at != null || v.rows.length > 0,
    ms,
  );

/** A gọi `@hoadon`; agent đặt `tool_confirmations` pending rồi trả câu xác nhận (như wait.int). */
async function sideEffect(room: string, wf: string) {
  const s = await invoke(c, "lan", room, "@hoadon tạo thẻ thanh toán");
  const job = await c.rt.next(s.runId);
  const [run] = await c.sql<
    { flow_id: string }[]
  >`select flow_id from hub.runs where id = ${s.runId}`;
  await c.sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
    values (${P.lan.tid}, ${P.lan.id}, ${run?.flow_id ?? s.runId}, ${s.runId}, ${AGB.hoadon}, ${wf}, 'pending')`;
  await c.rt.agent(job, { status: "done", text: "Xác nhận tạo thẻ PARAM-RV1 trên bảng Kế toán?" });
  const m = await waitAgentMsg(c, "lan", room, s.runId);
  expect(m?.ask?.kind).toBe("side_effect");
  return { s, m };
}
const confirmation = async (runId: string) =>
  (
    await c.sql<Json[]>`select status, decided_run_id, consumed_at from hub.tool_confirmations
      where run_id = ${runId}`
  )[0] ?? {};

describe("RV1-S1 · Minor #1 · chủ run sửa cột runs (scope user) ⇒ vòng đăng tin không bị lừa", () => {
  /** lan có thread T2 xong ở phòng R2; trả base flow của run R2 (flows.room_flow_id = T2) + T2. */
  async function otherThread() {
    const r2 = await group("lan", [P.hoa.id], "Nhóm RV1 khác");
    const s2 = await invoke(c, "lan", r2, "@hoadon kiểm tra R2");
    await answer(c, s2.runId, "R2 xong.");
    const m2 = await waitAgentMsg(c, "lan", r2, s2.runId);
    return { r2, baseFlow2: (await runRow(s2.runId)).flow_id as string, t2: m2?.flow_id as string };
  }
  /** lan gọi `@hoadon` ở R (hoa, tam thành viên), job đã claim (run đang chạy). */
  async function runningIn(name: string) {
    const room = await group("lan", [P.hoa.id, P.tam.id], name);
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-12");
    await c.rt.next(s.runId);
    return { room, runId: s.runId };
  }
  /** lan UPDATE hàng run của mình ở scope user (hub_rw + RLS hiện có) ⇒ [mã PG, số hàng]. */
  async function tamper(runId: string, set: Json): Promise<[string, number]> {
    let n = 0;
    const code = await asRw(P.lan, async (tx) => {
      const r = await tx`update hub.runs set ${tx(set)} where id = ${runId} returning id`;
      n = r.length;
    });
    return [code, n];
  }

  it("HUB-BR-22 · RV1-S1a · flow_id → base flow thread phòng khác (+ agent_id, status) ⇒ không tin agent nào gắn thread/phòng khác", async () => {
    const o = await otherThread();
    const { room, runId } = await runningIn("Nhóm RV1 S1a");
    await tamper(runId, {
      status: "finished",
      finished_at: new Date(),
      flow_id: o.baseFlow2,
      agent_id: AGB.trello,
    });
    await posted(runId);
    const rows = await agentRowsOf(runId);
    const inT2 = await c.sql<Json[]>`select id from hub.room_messages
      where (flow_id = ${o.t2} or room_id = ${o.r2}) and run_id = ${runId}`;
    expect({
      wrongPlace: rows.filter((m) => m.room_id !== room || m.flow_id === o.t2).length,
      inOther: inT2.length,
    }).toEqual({ wrongPlace: 0, inOther: 0 });
  }, 30_000);

  it("HUB-BR-22 · RV1-S1b · answer_message_id → tin C1 riêng của hoa ⇒ nội dung riêng không xuất hiện trong phòng, không chiếm id tin của hoa", async () => {
    const SECRET = "BI-MAT-HOA-RV1-91";
    const hoaMsg = await privateMsg(P.hoa, SECRET);
    const { room, runId } = await runningIn("Nhóm RV1 S1b");
    await tamper(runId, { status: "finished", finished_at: new Date(), answer_message_id: hoaMsg });
    await posted(runId);
    const leak = await c.sql<Json[]>`select id, room_id from hub.room_messages
      where content like ${`%${SECRET}%`} or id = ${hoaMsg}`;
    const tl = await api(c.hub, await c.tok("tam"), "GET", `/rooms/${room}/messages`);
    expect({ leak: leak.length, tl: JSON.stringify(tl.json).includes(SECRET) }).toEqual({
      leak: 0,
      tl: false,
    });
  }, 30_000);

  it("HUB-BR-22 · RV1-S1c · answer_message_id + flow_id → tin/flow tenant khác (an, beta) ⇒ không đăng gì từ tenant khác (hồi quy)", async () => {
    const SECRET = "BI-MAT-BETA-RV1-92";
    const anMsg = await privateMsg(P.an, SECRET, R.anConv, R.anFlow);
    const { runId } = await runningIn("Nhóm RV1 S1c");
    await tamper(runId, {
      status: "finished",
      finished_at: new Date(),
      answer_message_id: anMsg,
      flow_id: R.anFlow,
    });
    await posted(runId);
    const leak = await c.sql<Json[]>`select id from hub.room_messages
      where content like ${`%${SECRET}%`} or id = ${anMsg} or flow_id = ${R.anFlow}`;
    expect(leak.length).toBe(0);
  }, 30_000);
});

describe("RV1-S2 · Minor #3 · lượt chờ side_effect huỷ khi người gọi rời / bị bớt (R17, Q8)", () => {
  for (const how of ["rời", "bị bớt"] as const)
    it(`HUB-BR-22 · RV1-S2 · A ${how} rồi được thêm lại, xác nhận bằng answer_run_id cũ ⇒ 404/409, không run mới, xác nhận không còn pending`, async () => {
      const room = await group("hoa", [P.lan.id, P.tam.id], `Nhóm RV1 S2 ${how}`);
      const { s, m } = await sideEffect(
        room,
        how === "rời"
          ? "a2bb0000-0000-4000-8000-000000008301"
          : "a2bb0000-0000-4000-8000-000000008302",
      );
      const out =
        how === "rời"
          ? await api(c.hub, await c.tok("lan"), "POST", `/rooms/${room}/leave`)
          : await api(c.hub, await c.tok("hoa"), "DELETE", `/rooms/${room}/members/${P.lan.id}`);
      expect(out.status).toBe(204);
      const add = await api(c.hub, await c.tok("hoa"), "POST", `/rooms/${room}/members`, {
        user_ids: [P.lan.id],
      });
      expect(add.status).toBe(200);
      const r = await post(c, "lan", room, {
        content: "Đồng ý",
        flow_id: m?.flow_id,
        answer_run_id: s.runId,
      });
      const tc = await confirmation(s.runId);
      expect({
        rejected: [404, 409].includes(r.res.status),
        runId: r.runId,
        runs: (await roomRuns(c.sql, room)).length,
        pending: tc.status === "pending",
        consumed: tc.status === "consumed" || tc.status === "confirmed",
      }).toEqual({ rejected: true, runId: null, runs: 1, pending: false, consumed: false });
    }, 30_000);
});

describe("RV1-S3 · Minor #5 · hội thoại nền phòng không ghi được qua /conversations* (D2)", () => {
  it("HUB-BR-21 · RV1-S3 · PATCH/DELETE/POST messages (có/không flow_id)/GET flows/messages với id hội thoại nền ⇒ 404; DB không đổi", async () => {
    const room = await group("lan", [P.hoa.id], "Nhóm RV1 S3");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    await answer(c, s.runId, "Xong.");
    await waitAgentMsg(c, "lan", room, s.runId);
    const run = await runRow(s.runId);
    const conv = run.conversation_id as string;
    const base = run.flow_id as string;
    const snap = async () =>
      (
        await c.sql<Json[]>`select c.title, c.deleted_at, c.updated_at,
          (select count(*)::int from hub.runs r where r.conversation_id = c.id) as runs,
          (select count(*)::int from hub.messages m where m.conversation_id = c.id) as msgs
        from hub.conversations c where c.id = ${conv}`
      )[0];
    const before = await snap();
    const t = await c.tok("lan");
    const st = {
      patch: (await api(c.hub, t, "PATCH", `/conversations/${conv}`, { title: "Đổi RV1" })).status,
      send: (await api(c.hub, t, "POST", `/conversations/${conv}/messages`, { content: "vòng" }))
        .status,
      sendFlow: (
        await api(c.hub, t, "POST", `/conversations/${conv}/messages`, {
          content: "vòng flow",
          flow_id: base,
        })
      ).status,
      flows: (await api(c.hub, t, "GET", `/conversations/${conv}/flows`)).status,
      msgs: (await api(c.hub, t, "GET", `/conversations/${conv}/messages`)).status,
      del: (await api(c.hub, t, "DELETE", `/conversations/${conv}`)).status,
    };
    expect(st).toEqual({ patch: 404, send: 404, sendFlow: 404, flows: 404, msgs: 404, del: 404 });
    expect(await snap()).toEqual(before);
  }, 30_000);

  it("HUB-BR-21 · RV1-S3 · hội thoại C1 của mình + flow_id = flow nền phòng ⇒ không 201, không run trên flow nền", async () => {
    const room = await group("lan", [P.hoa.id], "Nhóm RV1 S3 flow");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    await answer(c, s.runId, "Xong.");
    await waitAgentMsg(c, "lan", room, s.runId);
    const base = (await runRow(s.runId)).flow_id as string;
    const r = await api(c.hub, await c.tok("lan"), "POST", `/conversations/${R.conv}/messages`, {
      content: "vòng qua C1",
      flow_id: base,
    });
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.runs where flow_id = ${base}`;
    expect({ created: r.status === 201, runs: n?.n }).toEqual({ created: false, runs: 1 });
  }, 30_000);
});

describe("RV1-S4 · Minor #6 · room_post_agent_message không tin sender do người gọi đưa", () => {
  it("HUB-BR-22 · RV1-S4 · scope system gọi thẳng với sender giả (trello) cho run hoadon ⇒ bị từ chối hoặc sender = agent của run", async () => {
    const room = await group("lan", [P.hoa.id], "Nhóm RV1 S4");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    await c.rt.next(s.runId);
    const code = await asRw(
      P.lan,
      async (tx) => {
        await tx`update hub.runs set status = 'finished', finished_at = now() where id = ${s.runId}`;
        await tx`select * from hub.room_post_agent_message(${s.runId}::uuid, ${AGB.trello}::uuid,
          'Tin giả mạo', '{"run_status":"finished"}'::jsonb)`;
      },
      "system",
    );
    const rows = await agentRowsOf(s.runId);
    const fake = rows.filter((m) => m.sender_id === AGB.trello).length;
    expect({ fake, ok: code !== "ok" || rows.every((m) => m.sender_id === AGB.hoadon) }).toEqual({
      fake: 0,
      ok: true,
    });
  }, 30_000);
});

describe("RV1-S5 · Minor #2 · room_run_states nhánh running chỉ run của thành viên hiện tại", () => {
  const states = async (who: Who, room: string) => {
    let rows: Json[] = [];
    await asUser(db, who, async (tx) => {
      rows = [...(await tx<Json[]>`select * from hub.room_run_states(${room}::uuid)`)];
    });
    return rows;
  };

  it("HUB-BR-22 · RV1-S5a · cuc (ngoài phòng) gắn run C1 của mình vào phòng (scope user) ⇒ không hiện trong room_run_states / active_runs của hoa", async () => {
    const room = await group("lan", [P.hoa.id], "Nhóm RV1 S5a");
    const [conv, flow, mu, ma, run] = [id(), id(), id(), id(), id()];
    await c.sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
      values (${conv}, ${P.cuc.tid}, ${P.cuc.id}, 'Của Cúc', 'cua cuc')`;
    await c.sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
      values (${flow}, ${P.cuc.tid}, ${P.cuc.id}, ${conv}, 'Của Cúc', 2)`;
    await c.sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
      (${mu}, ${P.cuc.tid}, ${P.cuc.id}, ${conv}, ${flow}, 'user', 'Hỏi', null),
      (${ma}, ${P.cuc.tid}, ${P.cuc.id}, ${conv}, ${flow}, 'assistant', '', ${run})`;
    await c.sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
        user_message_id, answer_message_id, owner, lease_until)
      values (${run}, ${P.cuc.tid}, ${P.cuc.id}, ${conv}, ${flow}, 'running', 1, ${mu}, ${ma},
        'qc-other-instance', now() + interval '1 hour')`;
    await asRw(P.cuc, (tx) => tx`update hub.runs set room_id = ${room} where id = ${run}`);
    const rows = await states(P.hoa, room);
    const detail = await api(c.hub, await c.tok("hoa"), "GET", `/rooms/${room}`);
    const active = (detail.json.active_runs ?? []) as Json[];
    expect({
      states: rows.filter((x) => x.run_id === run || x.caller_id === P.cuc.id).length,
      active: active.filter((x) => x.run_id === run).length,
    }).toEqual({ states: 0, active: 0 });
  }, 30_000);

  it("HUB-BR-22 · RV1-S5b · người gọi đã rời (left_at đặt, run chưa kịp huỷ) ⇒ run của họ không hiện cho thành viên còn lại", async () => {
    const room = await group("hoa", [P.lan.id], "Nhóm RV1 S5b");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    await c.rt.next(s.runId);
    await c.sql`update hub.room_members set left_at = now() where room_id = ${room} and user_id = ${P.lan.id}`;
    const rows = await states(P.hoa, room);
    expect({
      status: (await runRow(s.runId)).status,
      shown: rows.filter((x) => x.run_id === s.runId).length,
    }).toEqual({ status: "running", shown: 0 });
  }, 30_000);
});

describe("RV1-M4 · Minor #4 · '@orchestrator đồng ý' sau khi mất quyền agent (hồi quy)", () => {
  it("HUB-BR-21 · RV1-M4 · xác nhận side_effect của run 1 không bị run khác tiêu thụ, không job hoadon nào cho run khác", async () => {
    const room = await group("hoa", [P.lan.id, P.tam.id], "Nhóm RV1 M4");
    const { s, m } = await sideEffect(room, "a2bb0000-0000-4000-8000-000000008303");
    await c.sql`delete from hub.agent_grants where agent_id = ${AGB.hoadon} and subject_id = ${P.lan.id}`;
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    try {
      const r = await post(c, "lan", room, {
        content: "@orchestrator đồng ý",
        flow_id: m?.flow_id,
      });
      expect(r.res.status).toBeLessThan(500);
      const tc = await confirmation(s.runId);
      const [j] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.jobs j
        join hub.runs x on x.id = j.run_id
        where to_jsonb(x)->>'room_id' = ${room} and x.id <> ${s.runId} and j.agent_id = ${AGB.hoadon}`;
      expect({
        consumed: tc.status === "consumed" || tc.consumed_at != null,
        otherRun: tc.decided_run_id != null && tc.status === "consumed",
        hoadonJobs: j?.n,
      }).toEqual({ consumed: false, otherRun: false, hoadonJobs: 0 });
    } finally {
      await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        values (${AGB.hoadon}, ${P.lan.tid}, 'user', ${P.lan.id}) on conflict do nothing`;
      await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    }
  }, 30_000);
});
