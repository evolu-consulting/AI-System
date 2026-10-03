// CHAT-AC-16 · flow nghỉ khởi động lại chậm: header về ngay, `run.started` đến sau (plan C1 §2.2 FLOW_IDLE_S,
// §3.3 flow-cold, §3.5 seed; test-plan §4 flow-cold). Chỉ mock.

import { describe, expect, it } from "bun:test";
import {
  CHAT_SCN_PREFIX,
  type ChatEvent,
  ChatPageSchema,
  ConversationSchema,
  FlowSchema,
} from "@ai/contracts/chat";
import { call, lazySession, newConv, okJson, sendOpen, titles } from "./_client";
import { isMock, USERS } from "./_env";

const lan = lazySession(USERS.a);
const minh = lazySession(USERS.seeded);
const title = titles();

type Timing = { headerMs: number; startedMs: number; first: ChatEvent | null; flowId: string };

/** Gửi rồi đo: `headerMs` = từ lúc gửi tới khi có header; `startedMs` = từ header tới `run.started`. */
async function timedSend(
  token: string,
  convId: string,
  content: string,
  flowId?: string,
): Promise<Timing> {
  const t0 = performance.now();
  const { res, stream } = await sendOpen(token, convId, content, flowId);
  const tHeader = performance.now();
  const first = await stream.next();
  const tStarted = performance.now();
  await stream.rest();
  return {
    headerMs: tHeader - t0,
    startedMs: tStarted - tHeader,
    first,
    flowId: res.headers.get("X-Flow-Id") ?? "",
  };
}

describe.if(isMock)("flow-cold · chỉ mock", () => {
  it("CHAT-AC-16 · #scn:flow-cold: header < 1000 ms; run.started ≥ 1000 ms sau header [K-F1]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Flow lạnh"));
    const t = await timedSend(access, conv.id, `${CHAT_SCN_PREFIX}flow-cold Mở lại flow`);
    expect(t.headerMs).toBeLessThan(1000);
    expect(t.first?.event).toBe("run.started");
    expect(t.startedMs).toBeGreaterThanOrEqual(1000);
  });

  it("CHAT-AC-16 · tin kế tiếp cùng flow (đã ấm) → run.started < 500 ms sau khi gửi [K-F2]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Flow ấm"));
    const cold = await timedSend(access, conv.id, `${CHAT_SCN_PREFIX}flow-cold Câu đầu`);
    const warm = await timedSend(access, conv.id, "Câu tiếp theo", cold.flowId);
    expect(warm.first?.event).toBe("run.started");
    expect(warm.headerMs + warm.startedMs).toBeLessThan(500);
  });

  it("CHAT-AC-16 · minh gửi vào flow seed 'Hoá đơn…' (nghỉ 3 ngày), không tiền tố → cold như F1 [K-F3]", async () => {
    const { access } = await minh();
    const list = await call("GET", "/conversations?limit=200", { token: access });
    const items = (await okJson(list, 200, ChatPageSchema(ConversationSchema), "minh E5")).items;
    const conv = items.find((c) => c.title === "Hoá đơn tháng 9 cần đối chiếu");
    expect(conv?.title).toBe("Hoá đơn tháng 9 cần đối chiếu");
    const fres = await call("GET", `/conversations/${conv?.id}/flows`, { token: access });
    const flow = (await okJson(fres, 200, ChatPageSchema(FlowSchema), "minh E10")).items[0];
    expect(flow?.active_run_id ?? null).toBeNull();
    const t = await timedSend(access, conv?.id ?? "", "Đối chiếu giúp tôi", flow?.id);
    expect(t.headerMs).toBeLessThan(1000);
    expect(t.first?.event).toBe("run.started");
    expect(t.startedMs).toBeGreaterThanOrEqual(1000);
  });
});
