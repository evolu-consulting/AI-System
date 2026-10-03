// CHAT-AC-05, 12–15, 20, 26, 31, C1-R01, C1-R02 · E10–E12 tin nhắn và flow (plan C1 §2.4, §2.6, §3.2–§3.3;
// test-plan §4 messages).

import { describe, expect, it } from "bun:test";
import { UuidSchema } from "@ai/contracts";
import {
  CHAT_CONTENT_MAX,
  CHAT_SCN_PREFIX,
  ChatPageSchema,
  ConversationSchema,
  deriveTitle,
  FLOW_ID_HEADER,
  type Flow,
  FlowSchema,
  MESSAGE_ID_HEADER,
  type Message,
  MessageSchema,
  RUN_ID_HEADER,
  RunSchema,
} from "@ai/contracts/chat";
import {
  call,
  expectChatError,
  lazySession,
  newConv,
  okJson,
  type SendResult,
  send,
  sendOpen,
  terminal,
  titles,
  UNKNOWN_UUID,
} from "./_client";
import { isMock, USERS } from "./_env";

const lan = lazySession(USERS.a);
const title = titles();
const FlowPage = ChatPageSchema(FlowSchema);
const MessagePage = ChatPageSchema(MessageSchema);
const scn = (name: string, text: string) => `${CHAT_SCN_PREFIX}${name} ${text}`;

async function flows(token: string, convId: string): Promise<Flow[]> {
  const res = await call("GET", `/conversations/${convId}/flows?limit=200`, { token });
  return (await okJson(res, 200, FlowPage, "GET /conversations/:id/flows")).items;
}

async function messages(token: string, convId: string, flowId?: string): Promise<Message[]> {
  const q = flowId ? `?flow_id=${flowId}&limit=200` : "?limit=200";
  const res = await call("GET", `/conversations/${convId}/messages${q}`, { token });
  return (await okJson(res, 200, MessagePage, `GET /conversations/:id/messages${q}`)).items;
}

/** Hội thoại mới + 2 lần gửi ở ô chính (không `flow_id`). */
async function twoFlows(
  token: string,
): Promise<{ convId: string; createdAt: string; r1: SendResult; r2: SendResult }> {
  const conv = await newConv(token, title("Hai flow"));
  const r1 = await send(token, conv.id, "Câu 1");
  const r2 = await send(token, conv.id, "Câu 2");
  return { convId: conv.id, createdAt: conv.updated_at, r1, r2 };
}

function lastAssistant(items: Message[]): Message | undefined {
  return items.filter((m) => m.role === "assistant").at(-1);
}

describe("messages · gửi ở ô chính tạo flow mới (C1-R01)", () => {
  it("CHAT-AC-05 · 2 lần E12 không flow_id → 2 flow; header X-Run-Id/X-Flow-Id/X-Message-Id khớp run.started [K-M1]", async () => {
    const { access } = await lan();
    const { convId, r1, r2 } = await twoFlows(access);
    for (const r of [r1, r2]) {
      const first = r.events[0];
      expect(first?.event).toBe("run.started");
      if (first?.event !== "run.started") return;
      expect(r.res.headers.get(RUN_ID_HEADER)).toBe(first.data.run_id);
      expect(r.res.headers.get(FLOW_ID_HEADER)).toBe(first.data.flow_id);
      expect(UuidSchema.safeParse(r.res.headers.get(MESSAGE_ID_HEADER)).success).toBe(true);
    }
    expect(r1.flowId).not.toBe(r2.flowId);
    const fs = await flows(access, convId);
    expect(fs.map((f) => f.id)).toEqual([r1.flowId, r2.flowId]);
    expect(fs.map((f) => f.title)).toEqual([deriveTitle("Câu 1"), deriveTitle("Câu 2")]);
  });

  it("CHAT-AC-05 · sau 2 flow: E7 flow_count=2, updated_at tăng [K-M10]", async () => {
    const { access } = await lan();
    const { convId, createdAt } = await twoFlows(access);
    const res = await call("GET", `/conversations/${convId}`, { token: access });
    const conv = await okJson(res, 200, ConversationSchema, "GET /conversations/:id");
    expect(conv.flow_count).toBe(2);
    expect(Date.parse(conv.updated_at)).toBeGreaterThan(Date.parse(createdAt));
  });
});

describe("messages · gửi trong flow, đọc tin (E11, E12 có flow_id)", () => {
  it("CHAT-AC-13 · CHAT-AC-15 · E12 flow_id = flow 1 → tin vào flow 1; vẫn 2 flow; message_count 2 → 4 [K-M2]", async () => {
    const { access } = await lan();
    const { convId, r1 } = await twoFlows(access);
    expect((await flows(access, convId))[0]?.message_count).toBe(2);
    const r3 = await send(access, convId, "Câu 3 trong flow 1", r1.flowId);
    const first = r3.events[0];
    expect(first?.event === "run.started" ? first.data.flow_id : null).toBe(r1.flowId);
    const fs = await flows(access, convId);
    expect(fs.length).toBe(2);
    expect(fs.find((f) => f.id === r1.flowId)?.message_count).toBe(4);
  });

  it("CHAT-AC-14 · CHAT-AC-20 · E11 ?flow_id chỉ tin flow đó, tăng dần, user nguyên văn, assistant có run [K-M3]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Đọc tin"));
    const content = scn("normal", "Giữ nguyên văn");
    const r1 = await send(access, conv.id, content);
    await send(access, conv.id, "Flow khác");
    const items = await messages(access, conv.id, r1.flowId);
    expect(items.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(items.every((m) => m.flow_id === r1.flowId)).toBe(true);
    expect(Date.parse(items[0]?.created_at ?? "")).toBeLessThanOrEqual(
      Date.parse(items[1]?.created_at ?? ""),
    );
    expect(items[0]?.content).toBe(content);
    expect(items[0]?.id).toBe(r1.messageId);
    const end = terminal(r1.events);
    const asst = items[1];
    expect(asst?.run?.status).toBe("finished");
    expect(asst?.ask).toBeNull();
    expect(asst?.id).toBe(end?.event === "run.finished" ? end.data.message_id : "");
    expect((await messages(access, conv.id)).length).toBe(4);
  });

  it("CHAT-AC-31 · E12 content rỗng / khoảng trắng / 16001 ký tự / flow_id 'x' / thừa trường → 400 JSON [K-M5]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Validate gửi"));
    const bodies = [
      { content: "" },
      { content: "  " },
      { content: "a".repeat(CHAT_CONTENT_MAX + 1) },
      { content: "Ok", flow_id: "x" },
      { content: "Ok", la: 1 },
    ];
    for (const body of bodies) {
      const res = await call("POST", `/conversations/${conv.id}/messages`, { token: access, body });
      expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
      await expectChatError(res, "VALIDATION_ERROR", `E12 ${JSON.stringify(body).slice(0, 40)}`);
    }
  });

  it("CHAT-AC-31 · E12 flow_id của hội thoại khác / uuid lạ · hội thoại lạ → 404 NOT_FOUND [K-M6]", async () => {
    const { access } = await lan();
    const other = await newConv(access, title("Hội thoại khác"));
    const foreign = await send(access, other.id, "Flow ở hội thoại khác");
    const conv = await newConv(access, title("Hội thoại đích"));
    const post = (convId: string, flowId?: string) =>
      call("POST", `/conversations/${convId}/messages`, {
        token: access,
        body: flowId ? { content: "Câu", flow_id: flowId } : { content: "Câu" },
      });
    await expectChatError(
      await post(conv.id, foreign.flowId),
      "NOT_FOUND",
      "flow_id hội thoại khác",
    );
    await expectChatError(await post(conv.id, UNKNOWN_UUID), "NOT_FOUND", "flow_id lạ");
    await expectChatError(await post(UNKNOWN_UUID), "NOT_FOUND", "hội thoại lạ");
    const list = await call("GET", `/conversations/${conv.id}/messages?flow_id=${foreign.flowId}`, {
      token: access,
    });
    await expectChatError(list, "NOT_FOUND", "E11 flow_id hội thoại khác");
  });
});

describe.if(isMock)("messages · kịch bản mock", () => {
  it("C1-R02 · CHAT-AC-15 · tin thứ 2 trong flow: dòng cuối 'Flow này có 3 tin nhắn.' [K-M4]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Ngữ cảnh flow"));
    const r1 = await send(access, conv.id, "Câu mở flow");
    const r2 = await send(access, conv.id, "Câu thứ hai", r1.flowId);
    const end = terminal(r2.events);
    const content = end?.event === "run.finished" ? end.data.content : "";
    expect(content.trimEnd().split("\n").at(-1)?.trim()).toBe("Flow này có 3 tin nhắn.");
  });

  it("CHAT-AC-31 · gửi vào flow đang chạy (#scn:slow) → 409 FLOW_BUSY; E10 active_run_id = run đang chạy [K-M7]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Flow bận"));
    const { res, stream } = await sendOpen(access, conv.id, scn("slow", "Câu chậm"));
    const runId = res.headers.get(RUN_ID_HEADER) ?? "";
    const flowId = res.headers.get(FLOW_ID_HEADER) ?? "";
    try {
      await stream.next();
      const busy = await call("POST", `/conversations/${conv.id}/messages`, {
        token: access,
        body: { content: "Chen ngang", flow_id: flowId },
      });
      await expectChatError(busy, "FLOW_BUSY", "E12 flow đang chạy");
      expect((await flows(access, conv.id))[0]?.active_run_id).toBe(runId);
    } finally {
      await call("POST", `/runs/${runId}/cancel`, { token: access });
      await stream.cancel();
    }
    const after = await okJson(
      await call("GET", `/runs/${runId}`, { token: access }),
      200,
      RunSchema,
      "E14",
    );
    expect(after.status).not.toBe("running");
  });

  it("CHAT-AC-12 · #scn:ask xong → E11 tin assistant có ask đúng câu hỏi và 2 lựa chọn [K-M8]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Hỏi lại"));
    const r = await send(access, conv.id, scn("ask", "Tóm tắt giúp tôi"));
    const asst = lastAssistant(await messages(access, conv.id, r.flowId));
    expect(asst?.ask).toEqual({
      question: "Bạn muốn tóm tắt cuộc họp nào?",
      choices: ["Họp giao ban sáng nay", "Họp khách hàng Minh Phát"],
    });
    expect(asst?.run?.status).toBe("finished");
  });

  it("CHAT-AC-26 · #scn:err-timeout xong → E11 tin assistant run.status=failed, error.code=TIMEOUT [K-M11]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Lỗi timeout"));
    const r = await send(access, conv.id, scn("err-timeout", "Câu lỗi"));
    const asst = lastAssistant(await messages(access, conv.id, r.flowId));
    expect(asst?.run?.status).toBe("failed");
    expect(asst?.run?.error?.code).toBe("TIMEOUT");
  });
});
