// HUB-FR-96 · HUB-FR-101 · UAT X2b 2026-10-09 lỗi (a): xem trước phòng ở sidebar (`GET /rooms` `last_message.sender`) phải
// đứng tên agent như timeline — không lộ id (agent id / tenant id của Orchestrator).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { listItem, mkGroup } from "../X2a/_x2a";
import { answer, type CtxB, invoke, P, settle, startX2b, waitAgentMsg } from "./_x2b";

let c: CtxB;
beforeAll(async () => {
  c = await startX2b();
}, 60_000);
afterEach(() => settle(c.sql));
afterAll(() => c?.stop());

const group = async () =>
  (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id], "Nhóm xem trước")).id as string;

describe("UAT X2b (a) · xem trước phòng khi tin cuối là của agent", () => {
  it("HUB-FR-96 · last_message.sender.display_name = tên agent (vi), sender_type agent", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-7");
    await answer(c, s.runId, "HD-7 hợp lệ.");
    expect(await waitAgentMsg(c, "hoa", room, s.runId)).toBeDefined();
    const it = await listItem(c.hub, await c.tok("hoa"), room);
    expect(it?.last_message).toMatchObject({
      sender_type: "agent",
      sender: { display_name: "Hoá đơn" },
      preview: "HD-7 hợp lệ.",
    });
  });

  it("HUB-FR-96 · tin agent không gắn agent cụ thể (Orchestrator) → display_name 'Orchestrator', không phải id", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-8");
    await answer(c, s.runId, "HD-8 hợp lệ.");
    expect(await waitAgentMsg(c, "lan", room, s.runId)).toBeDefined();
    // Orchestrator đứng tên bằng id không thuộc `hub.agents` (UAT: tenant id).
    await c.sql`update hub.room_messages set sender_id = ${P.lan.tid}
      where room_id = ${room} and sender_type = 'agent'`;
    const it = await listItem(c.hub, await c.tok("lan"), room);
    expect(it?.last_message?.sender?.display_name).toBe("Orchestrator");
  });
});
