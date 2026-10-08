// HUB-FR-99 · HUB-FR-100 · HUB-FR-101 · X2b-AC16, R18, R19 · test-plan X2b §5 (I50–I56): sự kiện trạng thái run phòng qua
// `/me/stream` X2a (plan §2.3, §7) — `room.run_started/waiting/finished` tới thành viên hiện tại (2 instance Hub), không tới
// người ngoài phòng (sentinel X2a); chưa đọc tin agent tính cho người khác, không cho người gọi (R19, D14); `side_effect`:
// người khác không nhận tham số trong bất kỳ sự kiện nào (R12). Runtime = `ScriptRuntime` H1, không Dify.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  codeOf,
  type HubX2a,
  listItem,
  type MeEv,
  type MeStream,
  mkGroup,
  openMeStream,
  sentinel,
} from "../X2a/_x2a";
import { loadChat } from "./_modules";
import {
  AGB,
  answer,
  type CtxB,
  invoke,
  type Json,
  P,
  post,
  settle,
  startHubX2b,
  startX2b,
  waitAgentMsg,
} from "./_x2b";

let c: CtxB;
let hub2: HubX2a;
// biome-ignore lint/suspicious/noExplicitAny: contract X2b nạp động (chưa có lúc viết test)
let parseRun: ((event: string, data: string) => any) | null = null;
const streams: MeStream[] = [];
beforeAll(async () => {
  c = await startX2b({ instanceId: "qc-x2b-1" });
  hub2 = await startHubX2b(c.k, { instanceId: "qc-x2b-2" });
  const chat = await loadChat();
  parseRun =
    typeof chat.parseMeStreamRunEvent === "function"
      ? (chat.parseMeStreamRunEvent as typeof parseRun)
      : null;
}, 60_000);
afterEach(async () => {
  for (const s of streams.splice(0)) s.close();
  await settle(c.sql);
});
afterAll(async () => {
  await hub2?.stop();
  await c?.stop();
});

const SECRET = "PARAM-SECRET-77";
/** Mở stream `who` trên hub1 (mặc định) hoặc hub2. */
async function stream(who: "lan" | "hoa" | "tam" | "cuc", h: HubX2a = c.hub): Promise<MeStream> {
  const s = await openMeStream(h, await c.tok(who));
  expect(s.status).toBe(200);
  streams.push(s);
  return s;
}
const group = async (name: string) =>
  (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.tam.id], name)).id as string;
const runEv = (name: string, runId: string) => (e: MeEv) =>
  e.event === name && e.data?.run_id === runId;
const valid = (e: MeEv | undefined) => (e && parseRun ? parseRun(e.event, e.raw) !== null : false);

describe("X2b-AC16 · R18 · room.run_started / run_finished tới thành viên qua /me/stream (2 instance)", () => {
  it("HUB-FR-99 · X2b-AC16 · B nối hub2, A gọi qua hub1 ⇒ B nhận room.run_started {run_id, flow_id, agent hoadon, caller A} hợp lệ contract", async () => {
    const room = await group("Nhóm realtime 1");
    const sb = await stream("hoa", hub2);
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-12");
    const ev = await sb.until(runEv("room.run_started", s.runId), 3_000);
    expect({
      room_id: ev?.data?.room_id,
      flow_id: ev?.data?.flow_id,
      agent: ev?.data?.agent?.key,
      caller: ev?.data?.caller?.id,
      trigger: typeof ev?.data?.trigger_message_id,
      valid: valid(ev),
    }).toEqual({
      room_id: room,
      flow_id: s.flowId,
      agent: "hoadon",
      caller: P.lan.id,
      trigger: "string",
      valid: true,
    });
  });

  it("HUB-FR-99 · X2b-AC16 · Runtime trả kết quả ⇒ B nhận room.message tin agent rồi room.run_finished {status finished, message_id = tin agent}", async () => {
    const room = await group("Nhóm realtime 2");
    const sb = await stream("hoa", hub2);
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-12");
    await answer(c, s.runId, "HD-12 hợp lệ.");
    const fin = await sb.until(runEv("room.run_finished", s.runId), 8_000);
    const msg = sb.events.find(
      (e) => e.event === "room.message" && e.data?.message?.run_id === s.runId,
    );
    expect({
      status: fin?.data?.status,
      flow_id: fin?.data?.flow_id,
      message_id: fin?.data?.message_id,
      valid: valid(fin),
      sender_type: msg?.data?.message?.sender_type,
    }).toEqual({
      status: "finished",
      flow_id: s.flowId,
      message_id: msg?.data?.message?.id ?? "<tin agent>",
      valid: true,
      sender_type: "agent",
    });
  });

  it("HUB-FR-99 · X2b-R18 · E (thành viên) cũng nhận run_started; C ngoài phòng không nhận sự kiện nào của phòng (sentinel)", async () => {
    const room = await group("Nhóm realtime 3");
    const se = await stream("tam");
    const sc = await stream("cuc", hub2);
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    await answer(c, s.runId, "Xong.");
    expect(await se.until(runEv("room.run_finished", s.runId), 8_000)).toBeDefined();
    expect(se.events.some(runEv("room.run_started", s.runId))).toBe(true);
    expect(await sentinel(hub2, await c.tok("cuc"), sc, "x2b-rt3")).toBe(true);
    expect(sc.events.filter((e) => e.data?.room_id === room).map((e) => e.event)).toEqual([]);
  });

  it("HUB-FR-99 · X2b-R18 · lời gọi bị 429 (A đã 2 run) không phát run_started/room.message cho B", async () => {
    const room = await group("Nhóm realtime 429");
    const sb = await stream("hoa");
    await invoke(c, "lan", room, "@hoadon việc 1");
    await invoke(c, "lan", room, "@trello việc 2");
    const r = await post(c, "lan", room, { content: "@hoadon việc 3" });
    expect(r.res.status).toBe(429);
    expect(await sentinel(c.hub, await c.tok("hoa"), sb, "x2b-rt429")).toBe(true);
    const mine = sb.events.filter((e) => e.data?.room_id === room);
    expect(mine.filter((e) => e.event === "room.run_started").length).toBe(2);
    expect(mine.some((e) => e.data?.message?.content?.includes("việc 3"))).toBe(false);
  });
});

describe("X2b-R19 · chưa đọc: tin agent tính cho người khác, không cho người gọi (D14)", () => {
  it("HUB-FR-100 · X2b-AC16 · sau tin agent: B room.unread = 2 (tin gọi + tin agent), A = 0; GET /rooms khớp", async () => {
    const room = await group("Nhóm chưa đọc");
    const [sa, sb] = [await stream("lan"), await stream("hoa", hub2)];
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    await answer(c, s.runId, "Đã kiểm tra.");
    await sb.until(runEv("room.run_finished", s.runId), 8_000);
    await sa.until(runEv("room.run_finished", s.runId), 3_000);
    const last = (st: MeStream) =>
      st.events.filter((e) => e.event === "room.unread" && e.data?.room_id === room).at(-1)?.data
        ?.unread;
    expect({
      a: last(sa),
      b: last(sb),
      la: (await listItem(c.hub, await c.tok("lan"), room))?.unread,
      lb: (await listItem(c.hub, await c.tok("hoa"), room))?.unread,
    }).toEqual({ a: 0, b: 2, la: 0, lb: 2 });
  });
});

describe("X2b-R18 · R12 · room.run_waiting; side_effect không lộ tham số qua stream [hard-stop]", () => {
  it("HUB-FR-99 · X2b-R18 · need_input ⇒ B nhận room.run_waiting {caller_id A, kind need_input} hợp lệ contract", async () => {
    const room = await group("Nhóm chờ RT");
    const sb = await stream("hoa", hub2);
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    const job = await c.rt.next(s.runId);
    await c.rt.agent(job, {
      status: "need_input",
      question: "Số hoá đơn nào?",
      choices: ["HD-12"],
    });
    const ev = await sb.until(runEv("room.run_waiting", s.runId), 8_000);
    expect({
      caller_id: ev?.data?.caller_id,
      kind: ev?.data?.kind,
      flow_id: ev?.data?.flow_id,
      valid: valid(ev),
    }).toEqual({ caller_id: P.lan.id, kind: "need_input", flow_id: s.flowId, valid: true });
  });

  it("HUB-FR-95 · X2b-R12 · side_effect: B, E nhận run_waiting {kind side_effect}, mọi sự kiện của họ không chứa tham số; A nhận room.message có tham số", async () => {
    const room = await group("Nhóm xác nhận RT");
    const [sa, sb, se] = [await stream("lan"), await stream("hoa", hub2), await stream("tam")];
    const s = await invoke(c, "lan", room, "@hoadon tạo thẻ thanh toán");
    const job = await c.rt.next(s.runId);
    const [run] = await c.sql<
      { flow_id: string }[]
    >`select flow_id from hub.runs where id = ${s.runId}`;
    await c.sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
      values (${P.lan.tid}, ${P.lan.id}, ${run?.flow_id ?? s.runId}, ${s.runId}, ${AGB.hoadon},
        'a2bb0000-0000-4000-8000-000000008101', 'pending')`;
    await c.rt.agent(job, {
      status: "done",
      text: `Xác nhận tạo thẻ ${SECRET} trên bảng Kế toán?`,
    });
    const wb = await sb.until(runEv("room.run_waiting", s.runId), 8_000);
    await se.until(runEv("room.run_waiting", s.runId), 3_000);
    const ma = await sa.until(
      (e) => e.event === "room.message" && e.data?.message?.run_id === s.runId,
      3_000,
    );
    await waitAgentMsg(c, "hoa", room, s.runId);
    const raw = (st: MeStream) => st.events.map((e) => e.raw).join("\n");
    expect({
      kind: wb?.data?.kind,
      caller_id: wb?.data?.caller_id,
      bLeak: raw(sb).includes(SECRET),
      eLeak: raw(se).includes(SECRET),
      aHas: JSON.stringify(ma?.data ?? {}).includes(SECRET),
    }).toEqual({
      kind: "side_effect",
      caller_id: P.lan.id,
      bLeak: false,
      eLeak: false,
      aHas: true,
    });
  });

  it("HUB-BR-21 · X2b-R18 · B trả lời hộ (403 NOT_RUN_CALLER) không phát run_started", async () => {
    const room = await group("Nhóm 403 RT");
    const sb = await stream("hoa");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    const job = await c.rt.next(s.runId);
    await c.rt.agent(job, { status: "need_input", question: "Số hoá đơn nào?", choices: [] });
    const m = (await waitAgentMsg(c, "hoa", room, s.runId)) as Json | undefined;
    const r = await post(c, "hoa", room, {
      content: "HD-12",
      flow_id: m?.flow_id,
      answer_run_id: s.runId,
    });
    expect(codeOf(r.res)).toEqual({ status: 403, code: "NOT_RUN_CALLER" });
    expect(await sentinel(c.hub, await c.tok("hoa"), sb, "x2b-rt403")).toBe(true);
    const started = sb.events.filter(
      (e) => e.event === "room.run_started" && e.data?.room_id === room,
    );
    expect(started.map((e) => e.data?.run_id)).toEqual([s.runId]);
  });
});
