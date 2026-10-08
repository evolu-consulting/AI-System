// HUB-FR-28 · HUB-FR-95 · HUB-BR-21 · CHAT-AC-48 · X2b-R11, R12, Q5 · test-plan X2b §4 I30–I37: run phòng chờ `need_input` /
// `side_effect` — chỉ người gửi lượt trả lời/xác nhận (`answer_run_id`), người khác 403 `NOT_RUN_CALLER`; người khác không
// nhận tham số `side_effect` (server không trả). `side_effect` dựng như C1: `tool_confirmations` pending (SQL owner, như H2a
// confirm R1) trước khi Runtime giả trả câu hỏi xác nhận. Không Dify.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { api, codeOf, mkGroup } from "../X2a/_x2a";
import {
  AGB,
  type CtxB,
  invoke,
  type Json,
  P,
  post,
  roomRuns,
  settle,
  startX2b,
  timeline,
  waitAgentMsg,
} from "./_x2b";

let c: CtxB;
beforeAll(async () => {
  c = await startX2b();
}, 60_000);
afterEach(() => settle(c.sql));
afterAll(() => c?.stop());

const NOT_CALLER = { status: 403, code: "NOT_RUN_CALLER" };
const SECRET = "PARAM-SECRET-77";
const group = async (name: string) =>
  (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.tam.id], name)).id as string;

/** A gọi; Runtime giả trả need_input. */
async function needInput(room: string) {
  const s = await invoke(c, "lan", room, "@hoadon kiểm tra hoá đơn");
  const job = await c.rt.next(s.runId);
  await c.rt.agent(job, {
    status: "need_input",
    question: "Số hoá đơn nào?",
    choices: ["HD-12", "HD-13"],
  });
  const m = await waitAgentMsg(c, "hoa", room, s.runId);
  return { s, m };
}
/** A gọi; agent đặt `tool_confirmations` pending rồi trả câu xác nhận chứa tham số. */
async function sideEffect(room: string) {
  const s = await invoke(c, "lan", room, "@hoadon tạo thẻ thanh toán");
  const job = await c.rt.next(s.runId);
  const [run] = await c.sql<
    { flow_id: string }[]
  >`select flow_id from hub.runs where id = ${s.runId}`;
  await c.sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
    values (${P.lan.tid}, ${P.lan.id}, ${run?.flow_id ?? s.runId}, ${s.runId}, ${AGB.hoadon},
      'a2bb0000-0000-4000-8000-000000008001', 'pending')`;
  await c.rt.agent(job, { status: "done", text: `Xác nhận tạo thẻ ${SECRET} trên bảng Kế toán?` });
  const m = await waitAgentMsg(c, "hoa", room, s.runId);
  return { s, m };
}

describe("X2b-AC05 · need_input chỉ người gọi trả lời [CHAT-AC-48]", () => {
  it("HUB-FR-28 · X2b-AC05 · tin agent ask {kind need_input, question, choices}; B cũng thấy câu hỏi", async () => {
    const room = await group("Nhóm hỏi");
    const { m } = await needInput(room);
    expect(m?.ask).toEqual({
      kind: "need_input",
      question: "Số hoá đơn nào?",
      choices: ["HD-12", "HD-13"],
    });
  });

  it("HUB-FR-28 · X2b-AC05 · active_runs: status waiting, wait_kind need_input, caller A", async () => {
    const room = await group("Nhóm chờ");
    const { s } = await needInput(room);
    const r = await api(c.hub, await c.tok("hoa"), "GET", `/rooms/${room}`);
    const runs = (r.json.active_runs ?? []) as Json[];
    expect(runs.map((x) => [x.run_id, x.status, x.wait_kind, x.caller?.id])).toEqual([
      [s.runId, "waiting", "need_input", P.lan.id],
    ]);
  });

  it("HUB-BR-21 · X2b-AC05 · B gửi answer_run_id của A → 403 NOT_RUN_CALLER, không run mới, tin không lưu", async () => {
    const room = await group("Nhóm trả lời");
    const { s, m } = await needInput(room);
    const before = (await timeline(c, "hoa", room, `?flow_id=${m?.flow_id}`)).length;
    const r = await post(c, "hoa", room, {
      content: "HD-12",
      flow_id: m?.flow_id,
      answer_run_id: s.runId,
    });
    expect(codeOf(r.res)).toEqual(NOT_CALLER);
    expect(r.runId).toBeNull();
    expect((await roomRuns(c.sql, room)).length).toBe(1);
    expect((await timeline(c, "hoa", room, `?flow_id=${m?.flow_id}`)).length).toBe(before);
  });

  it("HUB-FR-28 · X2b-AC05 · A trả lời (answer_run_id của chính A) → 201 + run mới runs.user_id=A", async () => {
    const room = await group("Nhóm A trả lời");
    const { s, m } = await needInput(room);
    const r = await post(c, "lan", room, {
      content: "HD-12",
      flow_id: m?.flow_id,
      answer_run_id: s.runId,
    });
    expect(r.res.status).toBe(201);
    expect(r.runId).not.toBeNull();
    const runs = await roomRuns(c.sql, room);
    expect(runs.find((x) => x.id === r.runId)?.user_id).toBe(P.lan.id);
  });
});

describe("X2b-AC06 · side_effect chỉ người gọi xác nhận, người khác không thấy tham số [FR-95, Q5, hard-stop]", () => {
  it("HUB-FR-95 · X2b-AC06 · B: ask chỉ {kind side_effect}, toàn bộ tin agent B nhận không chứa tham số", async () => {
    const room = await group("Nhóm xác nhận");
    const { m } = await sideEffect(room);
    expect(m?.ask).toEqual({ kind: "side_effect" });
    const items = await timeline(c, "hoa", room);
    expect(JSON.stringify(items)).not.toContain(SECRET);
    const tam = await timeline(c, "tam", room);
    expect(JSON.stringify(tam)).not.toContain(SECRET);
  });

  it("HUB-FR-95 · X2b-AC06 · A (người gọi) thấy ask side_effect và nội dung đầy đủ có tham số", async () => {
    const room = await group("Nhóm xác nhận A");
    const { s } = await sideEffect(room);
    const mine = await waitAgentMsg(c, "lan", room, s.runId);
    expect(mine?.ask?.kind).toBe("side_effect");
    expect(JSON.stringify(mine ?? {})).toContain(SECRET);
  });

  it("HUB-FR-95 · X2b-AC06 · B gửi 'Đồng ý' kèm answer_run_id của A → 403 NOT_RUN_CALLER; xác nhận vẫn pending", async () => {
    const room = await group("Nhóm B đồng ý");
    const { s, m } = await sideEffect(room);
    const r = await post(c, "hoa", room, {
      content: "Đồng ý",
      flow_id: m?.flow_id,
      answer_run_id: s.runId,
    });
    expect(codeOf(r.res)).toEqual(NOT_CALLER);
    const [tc] = await c.sql<
      { status: string }[]
    >`select status from hub.tool_confirmations where run_id = ${s.runId}`;
    expect(tc?.status).toBe("pending");
  });

  it("HUB-FR-95 · X2b-AC06 · answer_run_id không phải run chờ của flow → 404 NOT_FOUND", async () => {
    const room = await group("Nhóm sai run");
    const { m } = await sideEffect(room);
    const r = await post(c, "lan", room, {
      content: "Đồng ý",
      flow_id: m?.flow_id,
      answer_run_id: "a2bb0000-0000-4000-8000-000000008999",
    });
    expect(codeOf(r.res)).toEqual({ status: 404, code: "NOT_FOUND" });
  });
});
