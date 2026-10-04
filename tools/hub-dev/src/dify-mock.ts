// Mock Dify cho Hub (H2a plan §9, task MK): API kiểu Dify, kịch bản chọn theo api key (Authorization: Bearer).
// Ghi lại request nhận được (`calls()` / `GET /__mock/requests`) để test assert `user`, `inputs`, Bearer.
// Khoá kịch bản: mk-ok · mk-outputs · mk-empty · mk-failed · mk-error-event · mk-401/404/400 · mk-503x<n> ·
// mk-slow-<ms> · mk-agent · LEAK_KEY_* (= ok). Chạy riêng: `bun run hub:dify-mock` (PORT, mặc định 5001).

export type MockCall = { path: string; auth: string; body: unknown; at: number };
export type DifyMock = {
  url: string;
  calls(): MockCall[];
  reset(): void;
  close(): Promise<void>;
};
export type DifyMockOptions = {
  port?: number;
  /** Mặc định false: `response_mode≠streaming` → 400 (đúng plan §9). true: hỗ trợ blocking. */
  allowBlocking?: boolean;
};

type Json = Record<string, unknown>;
type SimpleKind = "ok" | "outputs" | "empty" | "failed" | "error-event" | "agent";
type Scenario =
  | { kind: SimpleKind }
  | { kind: "http"; status: number; code: string }
  | { kind: "flaky"; times: number }
  | { kind: "slow"; ms: number };

const USAGE = {
  prompt_tokens: 12,
  completion_tokens: 8,
  total_tokens: 20,
  total_price: "0.0001",
  currency: "USD",
};
const CHUNKS = ["Xin ", "chào, ", "đây ", "là ", "mock."];
const HTTP_KEYS: Record<string, [number, string]> = {
  "mk-401": [401, "unauthorized"],
  "mk-404": [404, "not_found"],
  "mk-400": [400, "invalid_param"],
};
const SIMPLE = new Set<string>(["ok", "outputs", "empty", "failed", "error-event", "agent"]);

export function scenarioOf(key: string): Scenario {
  const http = HTTP_KEYS[key];
  if (http) return { kind: "http", status: http[0], code: http[1] };
  const flaky = /^mk-503x(\d+)$/.exec(key);
  if (flaky) return { kind: "flaky", times: Number(flaky[1]) };
  const slow = /^mk-slow-(\d+)$/.exec(key);
  if (slow) return { kind: "slow", ms: Number(slow[1]) };
  const name = key.startsWith("mk-") ? key.slice(3) : "ok";
  return { kind: (SIMPLE.has(name) ? name : "ok") as SimpleKind };
}

const enc = new TextEncoder();
const sse = (e: Json) => enc.encode(`event: ${String(e.event)}\ndata: ${JSON.stringify(e)}\n\n`);
const ping = () => enc.encode("event: ping\n\n");
const json = (status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errBody = (status: number, code: string) =>
  json(status, { code, message: `mock ${code}`, status });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ids = { task: string; run: string; msg: string; conv: string };
type Ctx = { chat: boolean; ids: Ids; stopped: Set<string> };

function base(c: Ctx): Json {
  return {
    task_id: c.ids.task,
    workflow_run_id: c.ids.run,
    message_id: c.ids.msg,
    conversation_id: c.ids.conv,
  };
}

function chunkEvents(c: Ctx, chatEvent = "message"): Json[] {
  return CHUNKS.map((t) =>
    c.chat
      ? { ...base(c), event: chatEvent, answer: t }
      : { ...base(c), event: "text_chunk", data: { text: t } },
  );
}

function finish(c: Ctx, status: string, extra: Json = {}): Json[] {
  if (c.chat) return [{ ...base(c), event: "message_end", metadata: { usage: USAGE } }];
  const outputs = status === "succeeded" ? { text: CHUNKS.join("") } : {};
  const data = { status, outputs, total_tokens: USAGE.total_tokens, metadata: { usage: USAGE } };
  return [{ ...base(c), event: "workflow_finished", data: { ...data, ...extra } }];
}

/** Dãy sự kiện cho kịch bản không chậm. */
export function events(s: Scenario, c: Ctx): Json[] {
  switch (s.kind) {
    case "outputs":
      return finish(c, "succeeded");
    case "empty":
      return finish(c, "succeeded", { outputs: {} });
    case "failed":
      return [...chunkEvents(c).slice(0, 1), ...finish(c, "failed", { error: "mock failed" })];
    case "error-event": {
      const err = { ...base(c), event: "error", status: 500, code: "mock_error", message: "mock" };
      return [...chunkEvents(c).slice(0, 2), err];
    }
    case "agent": {
      const th = {
        ...base(c),
        event: "agent_thought",
        id: "th1",
        thought: "dang nghi",
        position: 1,
      };
      return [th, ...chunkEvents(c, "agent_message"), ...finish(c, "succeeded")];
    }
    default:
      return [...chunkEvents(c), ...finish(c, "succeeded")];
  }
}

function blockingBody(s: Scenario, c: Ctx): Json {
  const evs = events(s, c);
  if (c.chat) {
    const answer = evs.map((e) => String(e.answer ?? "")).join("");
    return { ...base(c), answer, metadata: { usage: USAGE } };
  }
  return { ...base(c), data: (evs[evs.length - 1]?.data as Json) ?? {} };
}

async function slowStream(ms: number, c: Ctx, ctl: ReadableStreamDefaultController<Uint8Array>) {
  try {
    for (const e of chunkEvents(c)) {
      if (c.stopped.has(c.ids.task)) break;
      ctl.enqueue(sse(e));
      await wait(ms);
    }
    for (const e of finish(c, c.stopped.has(c.ids.task) ? "stopped" : "succeeded"))
      ctl.enqueue(sse(e));
  } catch {
    // client đã đóng kết nối
  }
}

function streamResponse(s: Scenario, c: Ctx): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(ctl) {
      ctl.enqueue(ping());
      if (s.kind === "slow") await slowStream(s.ms, c, ctl);
      else for (const e of events(s, c)) ctl.enqueue(sse(e));
      ctl.close();
    },
    cancel() {
      c.stopped.add(c.ids.task);
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

type State = {
  opts: DifyMockOptions;
  log: MockCall[];
  flaky: Map<string, number>;
  stopped: Set<string>;
  seq: number;
};

async function record(st: State, req: Request, path: string, auth: string): Promise<Json> {
  const text = req.method === "POST" ? await req.text() : "";
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = {};
  }
  st.log.push({ path, auth, body, at: Date.now() });
  return body;
}

function runApp(st: State, body: Json, chat: boolean, key: string) {
  const s = scenarioOf(key);
  if (s.kind === "http") return errBody(s.status, s.code);
  if (s.kind === "flaky") {
    const n = (st.flaky.get(key) ?? 0) + 1;
    st.flaky.set(key, n);
    if (n <= s.times) return errBody(503, "service_unavailable");
  }
  st.seq += 1;
  const q = st.seq;
  const ids = { task: `task-${q}`, run: `run-${q}`, msg: `msg-${q}`, conv: `conv-${q}` };
  const c: Ctx = { chat, ids, stopped: st.stopped };
  if (body.response_mode === "streaming") return streamResponse(s, c);
  return st.opts.allowBlocking ? json(200, blockingBody(s, c)) : errBody(400, "invalid_param");
}

async function route(st: State, req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path === "/__mock/requests") return json(200, { requests: st.log });
  const auth = req.headers.get("authorization") ?? "";
  const body = await record(st, req, path, auth);
  if (req.method === "GET" && path === "/v1/parameters")
    return json(200, { user_input_form: [], opening_statement: "" });
  if (req.method !== "POST") return errBody(404, "not_found");
  const stop = /^\/v1\/(?:workflows\/tasks|chat-messages)\/([^/]+)\/stop$/.exec(path);
  if (stop) {
    st.stopped.add(stop[1] as string);
    return json(200, { result: "success" });
  }
  const key = auth.replace(/^Bearer\s+/i, "");
  if (path === "/v1/workflows/run") return runApp(st, body, false, key);
  if (path === "/v1/chat-messages") return runApp(st, body, true, key);
  return errBody(404, "not_found");
}

export function startDifyMock(opts: DifyMockOptions = {}): DifyMock {
  const st: State = { opts, log: [], flaky: new Map(), stopped: new Set(), seq: 0 };
  const server = Bun.serve({
    port: opts.port ?? 0,
    fetch: (req) => route(st, req),
    idleTimeout: 0,
  });
  return {
    url: `http://localhost:${server.port}`,
    calls: () => [...st.log],
    reset: () => {
      st.log.length = 0;
      st.flaky.clear();
      st.stopped.clear();
      st.seq = 0;
    },
    close: async () => {
      await server.stop(true);
    },
  };
}

if (import.meta.main) {
  const m = startDifyMock({ port: Number(process.env.PORT ?? 5001) });
  console.log(`[dify-mock] ${m.url}  (requests: ${m.url}/__mock/requests)`);
}
