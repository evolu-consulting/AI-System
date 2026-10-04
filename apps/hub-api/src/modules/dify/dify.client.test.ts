// HUB-FR-13 · HUB-BR-04 · HUB-H2a-AC-03 · HUB-H2a-AC-04 · H2a-R09–R11, R15, R17 · client Dify với mock MK
// (`tools/hub-dev/src/dify-mock.ts`, trong tiến trình, không DB): SSE, kết quả, bảng lỗi plan-errors §2, stop khi huỷ,
// thân lỗi chứa key được che.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { type DifyMock, startDifyMock } from "../../../../../tools/hub-dev/src/dify-mock";
import { DifyClient, type DifyRunRequest } from "./dify.client";

let mk: DifyMock;
const client = new DifyClient();
const never = () => new AbortController().signal;

beforeAll(() => {
  mk = startDifyMock();
});
afterAll(async () => {
  await mk.close();
});
beforeEach(() => mk.reset());

const req = (apiKey: string, o: Partial<DifyRunRequest> = {}): DifyRunRequest => ({
  appType: "workflow",
  baseUrl: `${mk.url}/v1`,
  apiKey,
  inputs: { source_text: "xin", n: 3 },
  query: null,
  user: "acme:u1",
  conversationId: null,
  outputField: null,
  ...o,
});

async function run(r: DifyRunRequest, signal = never()) {
  const deltas: string[] = [];
  const out = await client.runStreaming(r, signal, (t) => deltas.push(t));
  return { out, deltas };
}

describe("HUB-FR-13 · run streaming với mock MK [H2a-R09, R15]", () => {
  it("HUB-FR-13 · mk-ok workflow: delta từng chunk, text gom, usage chuẩn hoá, task_id, body/auth đúng", async () => {
    const { out, deltas } = await run(req("mk-ok"));
    expect(deltas).toEqual(["Xin ", "chào, ", "đây ", "là ", "mock."]);
    expect(out).toMatchObject({
      kind: "finished",
      text: "Xin chào, đây là mock.",
      taskId: "task-1",
      usage: { input_tokens: 20, output_tokens: 0, cost_usd: 0.0001 },
    });
    const [c] = mk.calls();
    expect(c?.path).toBe("/v1/workflows/run");
    expect(c?.auth).toBe("Bearer mk-ok");
    expect(c?.body).toEqual({
      inputs: { source_text: "xin", n: 3 },
      response_mode: "streaming",
      user: "acme:u1",
    });
  });

  it("HUB-FR-13 · mk-outputs: không chunk → outputs[text]; app chat mk-agent: query + conversation_id", async () => {
    const a = await run(req("mk-outputs"));
    expect(a.deltas).toEqual([]);
    expect(a.out).toMatchObject({ kind: "finished", text: "Xin chào, đây là mock." });
    mk.reset();
    const b = await run(req("mk-agent", { appType: "agent", query: "hỏi", conversationId: "c0" }));
    expect(b.out).toMatchObject({
      kind: "finished",
      text: "Xin chào, đây là mock.",
      conversationId: "conv-1",
      taskId: "task-1",
      usage: { input_tokens: 12, output_tokens: 8 },
    });
    expect(mk.calls()[0]?.path).toBe("/v1/chat-messages");
    expect(mk.calls()[0]?.body).toMatchObject({ query: "hỏi", conversation_id: "c0" });
  });
});

describe("HUB-BR-04 · bảng lỗi plan-errors §2 [HUB-H2a-AC-03 · H2a-R11]", () => {
  it("HUB-BR-04 · HTTP 401/404 → NOT_CONFIGURED; 400, 503 → UPSTREAM_ERROR; một lời gọi (không retry)", async () => {
    for (const [key, code, status] of [
      ["mk-401", "NOT_CONFIGURED", 401],
      ["mk-404", "NOT_CONFIGURED", 404],
      ["mk-400", "UPSTREAM_ERROR", 400],
      ["mk-503x1", "UPSTREAM_ERROR", 503],
    ] as const) {
      mk.reset();
      const { out } = await run(req(key));
      expect(out).toMatchObject({ kind: "failed", code, reason: "upstream", httpStatus: status });
      expect(mk.calls().length).toBe(1);
    }
  });

  it("HUB-BR-04 · HTTP 200 nhưng status=failed, event error → UPSTREAM_ERROR upstream; outputs rỗng → invalid_output", async () => {
    for (const [key, reason] of [
      ["mk-failed", "upstream"],
      ["mk-error-event", "upstream"],
      ["mk-empty", "invalid_output"],
    ] as const) {
      const { out } = await run(req(key));
      expect(out).toMatchObject({ kind: "failed", code: "UPSTREAM_ERROR", reason });
    }
  });

  it("HUB-BR-04 · lỗi mạng / stream đứt trước kết thúc → UPSTREAM_ERROR upstream", async () => {
    const dead = await run(req("mk-ok", { baseUrl: "http://127.0.0.1:1/v1" }));
    expect(dead.out).toMatchObject({ kind: "failed", code: "UPSTREAM_ERROR", reason: "upstream" });
    const cut = new DifyClient({
      fetch: (async () =>
        new Response('event: message\ndata: {"event":"text_chunk","data":{"text":"a"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        })) as unknown as typeof fetch,
    });
    const out = await cut.runStreaming(req("x"), never(), () => {});
    expect(out).toMatchObject({ kind: "failed", code: "UPSTREAM_ERROR", reason: "upstream" });
  });
});

describe("HUB-H2a-AC-04 · thân lỗi chứa key được che [H2a-R17]", () => {
  it("HUB-H2a-AC-04 · 400 với key thô/base64/hex trong thân → detail ≤ 300, có ***, không dạng nào của key", async () => {
    const key = "LEAK_KEY_ECHO_unit_0123456789abcdef";
    const b = Buffer.from(key, "utf8");
    const body = `bad ${key} ${b.toString("base64")} ${b.toString("hex")} ${"x".repeat(500)}`;
    const c = new DifyClient({
      fetch: (async () => new Response(body, { status: 400 })) as unknown as typeof fetch,
    });
    const out = await c.runStreaming(req(key), never(), () => {});
    expect(out.kind).toBe("failed");
    const detail = out.kind === "failed" ? (out.detail ?? "") : "";
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(detail).toContain("***");
    for (const f of [key, b.toString("base64").replace(/=+$/, ""), b.toString("hex")])
      expect(detail).not.toContain(f);
  });
});

describe("HUB-FR-43 · huỷ gọi stop [H2a-R10]", () => {
  it("HUB-FR-43 · abort sau delta đầu → aborted + POST stop đúng path theo loại app, Bearer key", async () => {
    for (const [appType, path] of [
      ["workflow", "/v1/workflows/tasks/task-1/stop"],
      ["chat", "/v1/chat-messages/task-1/stop"],
    ] as const) {
      mk.reset();
      const ac = new AbortController();
      const t0 = Date.now();
      const out = await client.runStreaming(
        req("mk-slow-300", { appType, query: appType === "chat" ? "q" : null }),
        ac.signal,
        () => ac.abort(new Error("timeout")),
      );
      expect(out).toMatchObject({ kind: "aborted", taskId: "task-1" });
      expect(Date.now() - t0).toBeLessThan(2_000);
      const stops = mk.calls().filter((c) => c.path.endsWith("/stop"));
      expect(stops.map((s) => [s.path, s.auth])).toEqual([[path, "Bearer mk-slow-300"]]);
      expect(stops[0]?.body).toEqual({ user: "acme:u1" });
    }
  });

  it("HUB-FR-43 · abort trước khi có task_id → aborted, không gọi stop", async () => {
    const ac = new AbortController();
    ac.abort();
    const out = await client.runStreaming(req("mk-ok"), ac.signal, () => {});
    expect(out).toMatchObject({ kind: "aborted", taskId: null });
    expect(mk.calls().filter((c) => c.path.endsWith("/stop"))).toEqual([]);
  });
});
