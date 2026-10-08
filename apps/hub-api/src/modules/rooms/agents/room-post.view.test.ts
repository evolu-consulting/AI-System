import { describe, expect, it } from "bun:test";
import type { RoomMessageRow } from "../rooms.map";
import { type AgentData, agentViewFor, rowFor } from "./room-post.view";

const CALLER = "00000000-0000-4000-8000-000000000001";
const data = (o: Partial<AgentData> = {}): AgentData => ({
  runId: "00000000-0000-4000-8000-0000000000a1",
  triggerMessageId: "00000000-0000-4000-8000-0000000000b1",
  runStatus: "finished",
  waitKind: "side_effect",
  ask: null,
  stepCount: 2,
  runMs: 120,
  agent: { key: "hoadon", name: { vi: "Hoá đơn", en: "Invoice" } },
  caller: { id: CALLER, displayName: "Lan", username: "lan" },
  content: "Agent cần người gọi xác nhận một thao tác.",
  privateContent: "Xác nhận SECRET?",
  privateAsk: { question: "Tạo thẻ SECRET?", choices: ["Có"] },
  ...o,
});

describe("room-post.view · D3 tin agent theo người xem", () => {
  it("side_effect: người gọi thấy bản riêng, người khác bản công khai không tham số", () => {
    const mine = agentViewFor(data(), CALLER);
    const other = agentViewFor(data(), "00000000-0000-4000-8000-000000000002");
    expect(mine.content).toBe("Xác nhận SECRET?");
    expect(mine.agent.ask).toEqual({
      kind: "side_effect",
      question: "Tạo thẻ SECRET?",
      choices: ["Có"],
    });
    expect(JSON.stringify(other)).not.toContain("SECRET");
    expect(other.agent.ask).toEqual({ kind: "side_effect" });
    expect(other.agent.steps).toEqual({ count: 2, ms: 120 });
  });

  it("need_input / không chờ: mọi người cùng nội dung công khai", () => {
    const d = data({ waitKind: null, content: "Xong.", privateContent: "riêng" });
    expect(agentViewFor(d, CALLER).content).toBe("Xong.");
    expect(agentViewFor(d, CALLER).agent.ask).toBeUndefined();
  });

  it("rowFor: tin người giữ nguyên; tin agent lấy tên agent làm người gửi", () => {
    const row = {
      id: "x",
      roomId: "r",
      seq: 1,
      senderType: "agent",
      sender: { id: "a", displayName: null, username: null },
      content: "c",
      clientMsgId: null,
      createdAt: new Date(0),
    } satisfies RoomMessageRow;
    expect(rowFor(row, null, CALLER)).toBe(row);
    expect(rowFor(row, data({ agent: null }), CALLER).sender.displayName).toBe("Orchestrator");
  });
});
