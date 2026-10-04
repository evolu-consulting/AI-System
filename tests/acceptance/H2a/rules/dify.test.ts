// HUB-FR-13 · HUB-FR-80 · HUB-BR-04 · HUB-H2a-AC-03 · HUB-H2a-AC-04 · H2a-R09–R11, R14, R15, R17, R20 · luật thuần
// client Dify (test-plan H2a §4 R43–R49, cases §1.6; chữ ký plan-rules; bảng lỗi plan-errors §2).
import { describe, expect, it } from "bun:test";
import {
  difyAgentInput,
  difyRunBody,
  difyRunUrl,
  difyStopUrl,
  difyUsage,
  difyUser,
  finalText,
  interpretDifyEvent,
  mapDifyHttpError,
  maskInputs,
  maskSecret,
} from "../../../../apps/hub-api/src/modules/dify/dify.rules";
import { input, LEAK, uid } from "./_catalog";

const BASE = "http://dify.test/v1";
const U = `acme:${uid(1)}`;

describe("HUB-FR-13 · URL + body Dify [R43]", () => {
  it("HUB-FR-13 · H2a-R09 · run/stop URL theo loại app; body streaming, query chỉ chat [R43]", () => {
    expect(difyRunUrl("workflow", BASE)).toBe(`${BASE}/workflows/run`);
    expect(difyRunUrl("chat", BASE)).toBe(`${BASE}/chat-messages`);
    expect(difyRunUrl("agent", BASE)).toBe(`${BASE}/chat-messages`);
    expect(difyStopUrl("workflow", BASE, "t1")).toBe(`${BASE}/workflows/tasks/t1/stop`);
    expect(difyStopUrl("chat", BASE, "t1")).toBe(`${BASE}/chat-messages/t1/stop`);
    expect(difyStopUrl("agent", BASE, "t1")).toBe(`${BASE}/chat-messages/t1/stop`);
    const inputs = { source_text: "xin", n: 3, flag: true };
    expect(
      difyRunBody({ appType: "workflow", inputs, query: null, user: U, conversationId: null }),
    ).toEqual({ inputs, response_mode: "streaming", user: U });
    const chat = difyRunBody({
      appType: "chat",
      inputs,
      query: "hỏi",
      user: U,
      conversationId: null,
    });
    expect(chat).toMatchObject({ inputs, query: "hỏi", response_mode: "streaming", user: U });
    const conv = difyRunBody({
      appType: "agent",
      inputs,
      query: "q",
      user: U,
      conversationId: "c1",
    });
    expect(conv).toMatchObject({ query: "q", conversation_id: "c1", response_mode: "streaming" });
  });
});

describe("HUB-BR-04 · sự kiện + lỗi Dify [R44, R45]", () => {
  it("HUB-FR-13 · interpretDifyEvent: delta/meta/finished/error/ignore [R44]", () => {
    const ids = { task_id: "t1", workflow_run_id: "r1", message_id: "m1" };
    expect(interpretDifyEvent({ ...ids, event: "text_chunk", data: { text: "Xin " } })).toEqual({
      kind: "delta",
      text: "Xin ",
    });
    expect(interpretDifyEvent({ ...ids, event: "message", answer: "chào" })).toEqual({
      kind: "delta",
      text: "chào",
    });
    expect(interpretDifyEvent({ ...ids, event: "agent_message", answer: "bạn" })).toEqual({
      kind: "delta",
      text: "bạn",
    });
    expect(
      interpretDifyEvent({ ...ids, event: "workflow_started", data: { id: "r1" } }),
    ).toMatchObject({ kind: "meta", taskId: "t1" });
    const started = { ...ids, event: "workflow_started", conversation_id: "c1", data: {} };
    expect(interpretDifyEvent(started)).toMatchObject({
      kind: "meta",
      taskId: "t1",
      conversationId: "c1",
    });
    const wf = { status: "succeeded", outputs: { text: "x" }, total_tokens: 30 };
    const fin = interpretDifyEvent({ ...ids, event: "workflow_finished", data: wf });
    expect(fin).toMatchObject({ kind: "finished", status: "succeeded", outputs: { text: "x" } });
    if (fin.kind === "finished") expect(difyUsage(fin.usage).input_tokens).toBe(30);
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    const end = interpretDifyEvent({ ...ids, event: "message_end", metadata: { usage } });
    expect(end).toMatchObject({ kind: "finished", status: "succeeded", outputs: null });
    if (end.kind === "finished") expect(difyUsage(end.usage)).toMatchObject({ output_tokens: 5 });
    const failed = { ...ids, event: "workflow_finished", data: { status: "failed", outputs: {} } };
    expect(interpretDifyEvent(failed)).toMatchObject({ kind: "finished", status: "failed" });
    const err = { ...ids, event: "error", status: 500, code: "x", message: "boom" };
    expect(interpretDifyEvent(err)).toMatchObject({ kind: "error" });
    const node = { ...ids, event: "node_started", data: { title: "NODE_SECRET_TITLE" } };
    for (const e of [{ event: "ping" }, node, { ...ids, event: "agent_thought" }, null, "x"])
      expect(interpretDifyEvent(e)).toEqual({ kind: "ignore" });
  });

  it("HUB-BR-04 · HUB-H2a-AC-03 · mapDifyHttpError theo plan-errors §2 [R45]", () => {
    for (const s of [401, 403, 404]) expect(mapDifyHttpError(s)).toBe("NOT_CONFIGURED");
    for (const s of [400, 413, 415, 422, 429, 418, 500, 502, 503])
      expect(mapDifyHttpError(s)).toBe("UPSTREAM_ERROR");
  });
});

describe("HUB-FR-80 · kết quả, usage, user [R46–R48]", () => {
  it("HUB-BR-04 · finalText: chunk thắng; outputs[field ?? text]; object/số → JSON; rỗng → null [R46]", () => {
    expect(finalText("abc", { text: "khác" }, null)).toBe("abc");
    expect(finalText("", { text: "x" }, null)).toBe("x");
    expect(finalText("", { result: "y" }, "result")).toBe("y");
    expect(finalText("", { text: { a: 1 } }, null)).toBe('{"a":1}');
    expect(finalText("", { n: 5 }, "n")).toBe("5");
    expect(finalText("", { text: null }, null)).toBeNull();
    expect(finalText("", { text: "" }, null)).toBeNull();
    expect(finalText("", { other: "z" }, "result")).toBeNull();
    expect(finalText("", null, null)).toBeNull();
  });

  it("HUB-FR-80 · H2a-R15 · difyUsage: chat prompt/completion, workflow total, chỉ USD có cost [R47]", () => {
    const chat = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      total_price: "0.0012",
      currency: "USD",
    };
    expect(difyUsage(chat)).toEqual({ input_tokens: 10, output_tokens: 5, cost_usd: 0.0012 });
    expect(difyUsage({ total_tokens: 30 })).toEqual({
      input_tokens: 30,
      output_tokens: 0,
      cost_usd: 0,
    });
    expect(difyUsage({ ...chat, currency: "RMB" })).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0,
    });
    const zero = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    for (const junk of [undefined, null, "x", 42, {}, { prompt_tokens: "abc", total_price: "x" }])
      expect(difyUsage(junk)).toEqual(zero);
  });

  it("HUB-FR-80 · H2a-R14, R15 · difyUser, difyAgentInput [R48]", () => {
    expect(difyUser("acme", uid(1))).toBe(`acme:${uid(1)}`);
    const q = input("query", "text", { required: true });
    const a = input("a", "text", { required: true });
    const b = input("b", "text", { required: true });
    // Đếm MỌI input bắt buộc (mọi kiểu, kể cả select) — spec-decisions "WRITE — QW-A2 chốt".
    const sel = input("lang", "select", { required: true, options: ["en", "vi"] });
    expect(difyAgentInput([a, q, input("opt")])).toBe("query");
    expect(difyAgentInput([a, input("opt"), input("n", "number")])).toBe("a");
    expect(difyAgentInput([a, input("n", "number", { required: true })])).toBeNull();
    expect(difyAgentInput([a, sel])).toBeNull();
    expect(difyAgentInput([sel])).toBeNull();
    expect(difyAgentInput([a, b])).toBeNull();
    expect(difyAgentInput([input("opt")])).toBeNull();
    expect(difyAgentInput([])).toBeNull();
  });
});

describe("HUB-H2a-AC-04 · che secret [R49]", () => {
  it("HUB-H2a-AC-04 · H2a-R17, R20 · maskSecret che thô/base64/hex trước rồi cắt; maskInputs ≤ 200 [R49]", () => {
    const b64 = Buffer.from(LEAK, "utf8").toString("base64");
    const hex = Buffer.from(LEAK, "utf8").toString("hex");
    const raw = `a ${LEAK} b ${b64} c ${hex} d ${hex.toUpperCase()} e ${LEAK}`;
    const masked = maskSecret(raw, LEAK);
    // Padding `=` của base64 có thể còn lại (che bản không padding cũng đủ) — chỉ đòi không còn mảnh key nào.
    for (const leak of [LEAK, b64.replace(/=+$/, ""), hex, hex.toUpperCase()])
      expect(masked).not.toContain(leak);
    expect(masked.split("***").length - 1).toBe(5);
    expect(masked.startsWith("a *** b ***")).toBe(true);
    expect(masked.endsWith("d *** e ***")).toBe(true);
    const long = maskSecret(`${"x".repeat(1000)}${LEAK}`, LEAK);
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long).not.toContain("LEAK");
    expect(maskSecret(`${"a".repeat(290)}${LEAK}`, LEAK)).toBe(`${"a".repeat(290)}***`);
    expect(maskSecret("y".repeat(50), LEAK, 10).length).toBeLessThanOrEqual(10);
    const x = `${"a".repeat(190)}${LEAK}`;
    expect(maskInputs({ x, y: "b".repeat(250), n: 5 }, LEAK)).toEqual({
      x: `${"a".repeat(190)}***`,
      y: "b".repeat(200),
      n: "5",
    });
  });
});
