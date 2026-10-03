// CHAT-AC-06, 08, 09, 12, 24, 26, 27, 30, 31, 33 · SSE của E12 + E14 (plan C1 §2.5, §3.3; test-plan §4 stream).

import { describe, expect, it } from "bun:test";
import {
  CHAT_EVENT_NAMES,
  CHAT_SCN_PREFIX,
  type ChatEvent,
  ChatPageSchema,
  FlowSchema,
  MessageSchema,
  type RunFailedData,
  RunSchema,
} from "@ai/contracts/chat";
import {
  call,
  deepKeys,
  expectInvariants,
  FORBIDDEN_KEYS,
  joinDeltas,
  lazySession,
  newConv,
  okJson,
  send,
  terminal,
  titles,
} from "./_client";
import { isMock, USERS } from "./_env";

const lan = lazySession(USERS.a);
const title = titles();
const scn = (name: string, text: string) => `${CHAT_SCN_PREFIX}${name} ${text}`;

async function run(token: string, content: string) {
  const conv = await newConv(token, title("Stream"));
  const r = await send(token, conv.id, content);
  return { convId: conv.id, ...r };
}

async function getRun(token: string, runId: string) {
  return okJson(await call("GET", `/runs/${runId}`, { token }), 200, RunSchema, "GET /runs/:id");
}

function expectNoForbiddenKeys(value: unknown): void {
  const keys = deepKeys(value);
  for (const k of FORBIDDEN_KEYS) expect(keys.has(k)).toBe(false);
}

describe("stream · bất biến (mọi Hub)", () => {
  it("CHAT-AC-06 · CHAT-AC-33 · 'Xin chào': bất biến §2.5, nối delta = run.finished.content, message_id = tin E11 [K-S1]", async () => {
    const { access } = await lan();
    const r = await run(access, "Xin chào");
    expectInvariants(r.events);
    const end = terminal(r.events);
    expect(end?.event).toBe("run.finished");
    if (end?.event !== "run.finished") return;
    expect(joinDeltas(r.events)).toBe(end.data.content);
    const res = await call("GET", `/conversations/${r.convId}/messages?flow_id=${r.flowId}`, {
      token: access,
    });
    const items = (await okJson(res, 200, ChatPageSchema(MessageSchema), "E11")).items;
    const asst = items.find((m) => m.role === "assistant");
    expect(asst?.id).toBe(end.data.message_id);
    expect(asst?.content).toBe(end.data.content);
  });

  it("CHAT-AC-30 · CHAT-AC-33 · không key agent/provider/model/usage ở frame SSE và body E10/E11/E14 [K-S2]", async () => {
    const { access } = await lan();
    const r = await run(access, "Kiểm khoá cấm");
    expectNoForbiddenKeys(r.events);
    const token = access;
    const e10 = await call("GET", `/conversations/${r.convId}/flows`, { token });
    expectNoForbiddenKeys(await okJson(e10, 200, ChatPageSchema(FlowSchema), "E10"));
    const e11 = await call("GET", `/conversations/${r.convId}/messages`, { token });
    expectNoForbiddenKeys(await okJson(e11, 200, ChatPageSchema(MessageSchema), "E11"));
    expectNoForbiddenKeys(await getRun(access, r.runId));
  });

  it("CHAT-AC-31 · E14 sau khi xong: status=finished, finished_at, last_event_id = id cuối, error=null [K-S3]", async () => {
    const { access } = await lan();
    const r = await run(access, "Xin chào lần nữa");
    const got = await getRun(access, r.runId);
    expect(got.id).toBe(r.runId);
    expect(got.flow_id).toBe(r.flowId);
    expect(got.status).toBe("finished");
    expect(got.finished_at).not.toBeNull();
    expect(got.last_event_id).toBe(r.events.at(-1)?.id ?? -1);
    expect(got.error).toBeNull();
  });
});

const ERR_SCENARIOS = [
  ["err-exhausted", "ALL_PROVIDERS_EXHAUSTED"],
  ["err-timeout", "TIMEOUT"],
  ["err-upstream", "UPSTREAM_ERROR"],
] as const;

/** Rút gọn để so trình tự: tên sự kiện + data không có trường uuid. */
function shape(e: ChatEvent): string {
  if (e.event === "step.started") return `step.started:${e.data.step_id}:${e.data.label}`;
  if (e.event === "step.finished")
    return `step.finished:${e.data.step_id}:${e.data.status}:${e.data.ms}`;
  if (e.event === "run.finished") return `run.finished:${e.data.ms}`;
  return e.event;
}

describe.if(isMock)("stream · kịch bản mock", () => {
  it("CHAT-AC-08 · CHAT-AC-09 · #scn:steps: 2 bước 'Hiểu yêu cầu' 2100 ms → 'Đang viết email' 5700 ms → delta → 7800 ms [K-S4]", async () => {
    const { access } = await lan();
    const r = await run(access, scn("steps", "Soạn email"));
    expectInvariants(r.events);
    const seq = r.events.map(shape);
    const compact = seq.filter((s, i) => !(s === "delta" && seq[i - 1] === "delta"));
    expect(compact).toEqual([
      "run.started",
      "step.started:s1:Hiểu yêu cầu",
      "step.finished:s1:ok:2100",
      "step.started:s2:Đang viết email",
      "step.finished:s2:ok:5700",
      "delta",
      "run.finished:7800",
    ]);
  });

  it("CHAT-AC-12 · #scn:ask: ask 2 lựa chọn rồi run.finished ngay sau [K-S5]", async () => {
    const { access } = await lan();
    const r = await run(access, scn("ask", "Tóm tắt"));
    expectInvariants(r.events);
    const i = r.events.findIndex((e) => e.event === "ask");
    const ask = r.events[i];
    expect(ask?.event === "ask" ? ask.data.choices.length : -1).toBe(2);
    expect(r.events[i + 1]?.event).toBe("run.finished");
    expect(i + 2).toBe(r.events.length);
  });

  it("UC-02 · quota: #scn:quota-over {over,104} · #scn:quota-warn {warn,85} · không tiền tố {ok,12} [K-S6]", async () => {
    const { access } = await lan();
    const cases = [
      [scn("quota-over", "Vượt"), { state: "over", pct: 104 }],
      [scn("quota-warn", "Cảnh báo"), { state: "warn", pct: 85 }],
      ["Không tiền tố", { state: "ok", pct: 12 }],
    ] as const;
    for (const [content, quota] of cases) {
      const first = (await run(access, content)).events[0];
      expect(first?.event === "run.started" ? first.data.quota : null).toEqual(quota);
    }
  });

  it("CHAT-AC-24 · CHAT-AC-26 · CHAT-AC-27 · #scn:err-*: step failed → run.failed đúng mã; E14 failed [K-S7]", async () => {
    const { access } = await lan();
    for (const [name, code] of ERR_SCENARIOS) {
      const r = await run(access, scn(name, "Lỗi"));
      expectInvariants(r.events);
      const end = r.events.at(-1);
      expect(r.events.at(-2)?.event === "step.finished" ? r.events.at(-2) : null).toMatchObject({
        data: { status: "failed" },
      });
      expect(end?.event).toBe("run.failed");
      const data = (end?.data ?? {}) as Partial<RunFailedData>;
      expect(data.code).toBe(code);
      expect(data.run_id).toBe(r.runId);
      expect(data.message?.length ?? 0).toBeGreaterThan(0);
      const got = await getRun(access, r.runId);
      expect(got.status).toBe("failed");
      expect(got.error?.code).toBe(code);
    }
  });

  it("CHAT-AC-31 · CHAT-AC-33 · gộp normal/steps/ask/err-* thấy đủ 7 loại sự kiện, không khoá cấm [K-S8]", async () => {
    const { access } = await lan();
    const seen = new Set<string>();
    for (const content of [
      "Bình thường",
      scn("steps", "B"),
      scn("ask", "H"),
      scn("err-timeout", "L"),
    ]) {
      const r = await run(access, content);
      expectNoForbiddenKeys(r.events);
      for (const e of r.events) seen.add(e.event);
    }
    expect([...seen].sort()).toEqual([...CHAT_EVENT_NAMES].sort());
  });

  it("CHAT-AC-06 · #scn:markdown: content có bảng '|' và khối ```ts [K-S10]", async () => {
    const { access } = await lan();
    const end = terminal((await run(access, scn("markdown", "Bảng"))).events);
    const content = end?.event === "run.finished" ? end.data.content : "";
    expect(content).toMatch(/^\|.*\|\s*$/m);
    expect(content).toContain("```ts");
  });
});
