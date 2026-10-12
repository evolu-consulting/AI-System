// HUB-FR-44 · HUB-FR-101 · HUB-FR-95 · X2b2-R11 (bổ sung 2026-10-13, RV1 #1) · AC10 · test-plan X2b2 §3.8 I55–I58: `out/` của
// tin agent đang chờ xác nhận `side_effect` chỉ NGƯỜI GỌI xem/tải tới khi `tool_confirmations` của run hết `pending`; người
// khác: không ref (trang tin + `room.message`), `/attachments/:id` và `/content` 404, không vào `runs.attachment_ids` của run
// họ. Sau khi A đồng ý / huỷ (run kế) ⇒ B thấy ref ở lần tải trang kế và tải 200. `side_effect` dựng như X2b `wait.int`
// (`tool_confirmations` pending bằng SQL owner trước khi Runtime giả trả lời).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { codeOf, type MeEv, openMeStream } from "../X2a/_x2a";
import { AGB, answer, invoke, P, post, settle, timeline, waitAgentMsg } from "../X2b/_x2b";
import {
  type CtxX,
  dropUnbound,
  finishWith,
  getAtt,
  getContent,
  group,
  type Job,
  type Json,
  jobOutput,
  runFiles,
  sendRoom,
  startX2b2,
  text,
  waitRunStatus,
} from "./_x2b2";

let c: CtxX;
beforeAll(async () => {
  c = await startX2b2();
}, 60_000);
afterEach(async () => {
  await settle(c.sql);
  await dropUnbound(c.sql);
});
afterAll(() => c?.stop());

const MD = text("# Báo cáo\n\nThẻ thanh toán sẽ tạo.\n");
const NOT_FOUND = { status: 404, code: "NOT_FOUND" };
const WF = "a2bb0000-0000-4000-8000-000000008001";
type Pending = { room: string; runId: string; flowId: string; job: Job; out: string };

/** G {A=lan, B=hoa}; A '@hoadon tạo thẻ'; `tool_confirmations` pending; job ghi out/report.md (chưa kết thúc). */
async function pendingRun(name: string): Promise<Pending> {
  const room = await group(c, "lan", ["hoa"], name);
  const s = await invoke(c, "lan", room, "@hoadon tạo thẻ thanh toán");
  const job = await c.rt.next(s.runId);
  const [run] = await c.sql<
    { flow_id: string }[]
  >`select flow_id from hub.runs where id = ${s.runId}`;
  const flowId = run?.flow_id ?? "";
  await c.sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
    values (${P.lan.tid}, ${P.lan.id}, ${flowId}, ${s.runId}, ${AGB.hoadon}, ${WF}, 'pending')`;
  const out = await jobOutput(c, job, "report.md", MD);
  return { room, runId: s.runId, flowId, job, out };
}
/** Như trên + Runtime giả trả câu xác nhận kèm `outputs` ⇒ tin agent của run tồn tại (A thấy). */
async function pendingAnswered(name: string): Promise<Pending> {
  const p = await pendingRun(name);
  await finishWith(c, p.job, "Xác nhận tạo thẻ thanh toán trên bảng Kế toán?", [p.out]);
  expect(await waitAgentMsg(c, "lan", p.room, p.runId)).toBeDefined();
  return p;
}
const agentOf = (items: Json[], runId: string) =>
  items.find((m) => m.sender_type === "agent" && m.run_id === runId);
const agentEv = (runId: string) => (e: MeEv) =>
  e.event === "room.message" &&
  e.data?.message?.sender_type === "agent" &&
  e.data?.message?.run_id === runId;
const refIds = (m: Json | undefined) => ((m?.attachments ?? []) as Json[]).map((a) => a.id);

describe("X2b2-R11 · out/ khi chờ side_effect chỉ người gọi [AC10, RV1 #1]", () => {
  it("HUB-FR-101 · X2b2-R11 · I55 · chờ side_effect: trang tin + room.message của B không có attachments; của A có [report.md]", async () => {
    const p = await pendingRun("Phòng chờ I55");
    const sa = await openMeStream(c.hub, await c.tok("lan"));
    const sb = await openMeStream(c.hub, await c.tok("hoa"));
    try {
      await finishWith(c, p.job, "Xác nhận tạo thẻ thanh toán trên bảng Kế toán?", [p.out]);
      const ea = await sa.until(agentEv(p.runId), 8_000);
      const eb = await sb.until(agentEv(p.runId), 8_000);
      expect(ea?.valid).toBe(true);
      expect(eb?.valid).toBe(true);
      expect(refIds(ea?.data?.message)).toEqual([p.out]);
      expect(eb?.data?.message?.attachments ?? []).toEqual([]);
    } finally {
      sa.close();
      sb.close();
    }
    const mine = await waitAgentMsg(c, "lan", p.room, p.runId);
    expect(mine?.attachments).toEqual([
      { id: p.out, filename: "report.md", mime: "text/markdown", size: MD.length, available: true },
    ]);
    const theirs = await waitAgentMsg(c, "hoa", p.room, p.runId);
    expect(theirs).toBeDefined();
    expect(theirs?.attachments ?? []).toEqual([]);
    expect(JSON.stringify(await timeline(c, "hoa", p.room))).not.toContain(p.out);
  });

  it("HUB-FR-101 · X2b2-R11 · I56 · chờ side_effect: B GET /attachments/:id và /content ⇒ 404 NOT_FOUND; A ⇒ 200", async () => {
    const p = await pendingAnswered("Phòng chờ I56");
    expect(codeOf(await getAtt(c, "hoa", p.out))).toEqual(NOT_FOUND);
    expect(codeOf(await getContent(c, "hoa", p.out))).toEqual(NOT_FOUND);
    expect((await getAtt(c, "lan", p.out)).status).toBe(200);
    expect((await getContent(c, "lan", p.out)).status).toBe(200);
  });

  it("HUB-FR-101 · X2b2-R11 · I57 · chờ side_effect: B tag agent trong cùng thread ⇒ runs.attachment_ids của B không chứa file; đối chứng: sau khi A đồng ý, B tag lại ⇒ có file", async () => {
    const p = await pendingAnswered("Phòng chờ I57");
    const b1 = await sendRoom(c, "hoa", p.room, { content: "@trello xem", flow_id: p.flowId });
    expect(b1.res.status).toBe(201);
    expect(b1.runId ?? "").not.toBe("");
    expect(await runFiles(c.sql, b1.runId ?? "")).not.toContain(p.out);
    await answer(c, b1.runId ?? "", "Đã xem.");
    await waitRunStatus(c.sql, b1.runId ?? "", ["finished"]);
    const r2 = await resolve(p, "Đồng ý", "confirmed");
    await answer(c, r2, "Đã tạo thẻ.");
    await waitRunStatus(c.sql, r2, ["finished"]);
    const b2 = await sendRoom(c, "hoa", p.room, { content: "@trello xem lại", flow_id: p.flowId });
    expect(b2.res.status).toBe(201);
    expect(await runFiles(c.sql, b2.runId ?? "")).toContain(p.out);
  });

  for (const [reply, status] of [
    ["Đồng ý", "confirmed"],
    ["Huỷ", "declined"],
  ] as const) {
    it(`HUB-FR-101 · X2b2-R11 · I58 · A trả lời '${reply}' (run kế, ${status}) ⇒ B tải lại trang thấy ref [report.md] và tải 200`, async () => {
      const p = await pendingAnswered(`Phòng chờ I58 ${status}`);
      expect(codeOf(await getContent(c, "hoa", p.out))).toEqual(NOT_FOUND);
      await resolve(p, reply, status);
      const theirs = agentOf(await timeline(c, "hoa", p.room), p.runId);
      expect(refIds(theirs)).toEqual([p.out]);
      expect((await getAtt(c, "hoa", p.out)).status).toBe(200);
      expect((await getContent(c, "hoa", p.out)).status).toBe(200);
    });
  }
});

/** A trả lời run chờ (`answer_run_id`) ⇒ 201 + `tool_confirmations` của run = `want` (server quyết, H2a-R22). */
async function resolve(p: Pending, content: string, want: string): Promise<string> {
  const r = await post(c, "lan", p.room, { content, flow_id: p.flowId, answer_run_id: p.runId });
  expect(r.res.status).toBe(201);
  const [tc] = await c.sql<
    { status: string }[]
  >`select status from hub.tool_confirmations where run_id = ${p.runId}`;
  expect(tc?.status).toBe(want);
  return r.runId ?? "";
}
