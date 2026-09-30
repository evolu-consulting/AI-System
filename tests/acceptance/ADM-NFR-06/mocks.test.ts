// ADM-NFR-06 · M0-AC15 · mock Dify + Hub (spec §3.2, §3.3, §3.4, T-MOCK-1; test-plan §3.10 A–J)
import { afterAll, describe, expect, it } from "bun:test";
import { createDifyMock } from "../../../tools/mocks/src/dify";
import { createHubMock } from "../../../tools/mocks/src/hub";

type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
type Opts = { auth?: string; scenario?: string; body?: unknown; raw?: string };

const TIMEOUT_MS = 50;
const MIN_WAIT_MS = 45; // < 50 để chừa sai số đồng hồ
const dify = createDifyMock({ timeoutMs: TIMEOUT_MS });
const hub = createHubMock({ timeoutMs: TIMEOUT_MS });

const U = "00000000-0000-7000-8000-0000000000c1";
const WF_BODY = { inputs: { text: "a" }, response_mode: "blocking", user: "u1" };
const CHAT_BODY = { query: "hi", inputs: {}, response_mode: "blocking", user: "u1" };
const RUN_BODY = { command: { steps: [{ type: "llm" }] }, inputs: { text: "a" } };
const D401 = { code: "unauthorized", message: "Access token is invalid", status: 401 };
const H401 = { error: { code: "UNAUTHORIZED", message: "Invalid token" } };
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };
const d400 = (message: string) => ({ code: "invalid_param", message, status: 400 });
const h400 = (message: string) => ({ error: { code: "VALIDATION_FAILED", message } });

const WF_OK = {
  workflow_run_id: "mock-wfr-0001",
  task_id: "mock-task-0001",
  data: {
    id: "mock-wfr-0001",
    workflow_id: "mock-wf-0001",
    status: "succeeded",
    outputs: { text: 'mock:{"text":"a"}' },
    error: null,
    elapsed_time: 0.12,
    total_tokens: 42,
    total_steps: 3,
    created_at: 1767225600,
    finished_at: 1767225601,
  },
};
const CHAT_OK = {
  event: "message",
  message_id: "mock-msg-0001",
  conversation_id: "mock-conv-0001",
  mode: "chat",
  answer: "mock answer: hi",
  metadata: {
    usage: {
      prompt_tokens: 30,
      completion_tokens: 12,
      total_tokens: 42,
      total_price: "0.000100",
      currency: "USD",
      latency: 0.12,
    },
  },
  created_at: 1767225600,
};
const PARAMS_OK = {
  user_input_form: [
    {
      "text-input": {
        label: "text",
        variable: "text",
        required: true,
        max_length: 256,
        default: "",
      },
    },
    {
      select: {
        label: "lang",
        variable: "lang",
        required: true,
        options: ["vi", "en"],
        default: "vi",
      },
    },
  ],
  system_parameters: {},
};
const RUN_OK = {
  run_id: "00000000-0000-7000-8000-000000000001",
  status: "succeeded",
  output: { text: 'mock:{"text":"a"}' },
  ms: 120,
  trace: [],
};
const GRANTS_OK = {
  items: [
    {
      agent_id: "00000000-0000-7000-8000-0000000000a1",
      key: "invoice-checker",
      name: { vi: "Kiểm tra hoá đơn", en: "Invoice checker" },
      reasons: ["group:mock-group"],
    },
  ],
};

function headersOf(o: Opts): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (o.auth !== undefined) h.Authorization = o.auth;
  if (o.scenario !== undefined) h["X-Mock-Scenario"] = o.scenario;
  return h;
}

function bodyOf(o: Opts): string | undefined {
  if (o.raw !== undefined) return o.raw;
  return o.body === undefined ? undefined : JSON.stringify(o.body);
}

function call(app: App, method: string, path: string, o: Opts = {}): Promise<Response> {
  return Promise.resolve(app.request(path, { method, headers: headersOf(o), body: bodyOf(o) }));
}

async function expectJson(res: Response, status: number, body: unknown): Promise<void> {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type") ?? "").toContain("application/json");
  expect(await res.json()).toEqual(body);
}

async function timed(p: () => Promise<Response>): Promise<{ res: Response; ms: number }> {
  const t0 = performance.now();
  const res = await p();
  return { res, ms: performance.now() - t0 };
}

const wf = (o: Opts) => call(dify, "POST", "/v1/workflows/run", o);
const chat = (o: Opts) => call(dify, "POST", "/v1/chat-messages", o);
const run = (o: Opts) => call(hub, "POST", "/internal/test-run", o);
const OK = "Bearer app-mock-ok";
const HOK = "Bearer mock-ok";

// Huỷ phía client cần HTTP thật: app.request in-process không huỷ được handler đang chờ.
const difySrv = Bun.serve({ port: 0, fetch: createDifyMock({ timeoutMs: TIMEOUT_MS }).fetch });
const hubSrv = Bun.serve({ port: 0, fetch: createHubMock({ timeoutMs: TIMEOUT_MS }).fetch });
afterAll(() => {
  difySrv.stop(true);
  hubSrv.stop(true);
});

async function abortedName(url: string, headers: Record<string, string>, body: unknown) {
  const err = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20),
  }).then(
    () => null,
    (e: unknown) => e as Error,
  );
  return err?.name ?? "khong-bi-huy";
}

describe("ADM-NFR-06 · M0-AC15 · A. Dify kịch bản ok", () => {
  it("ADM-NFR-06 · M0-AC15 · workflows/run với app-mock-ok và token lạ → 200 body cố định", async () => {
    for (const auth of [OK, "Bearer app-whatever"]) {
      await expectJson(await wf({ auth, body: WF_BODY }), 200, WF_OK);
    }
  });

  it("ADM-NFR-06 · M0-AC15 · chat-messages → 200 body cố định; có conversation_id vẫn 200", async () => {
    await expectJson(await chat({ auth: OK, body: CHAT_BODY }), 200, CHAT_OK);
    const withConv = await chat({ auth: OK, body: { ...CHAT_BODY, conversation_id: "c1" } });
    expect(withConv.status).toBe(200);
  });

  it("ADM-NFR-06 · M0-AC15 · GET /v1/parameters → 200 body cố định", async () => {
    await expectJson(await call(dify, "GET", "/v1/parameters", { auth: OK }), 200, PARAMS_OK);
  });

  it("ADM-NFR-06 · M0-AC15 · tiền tố Bearer không phân biệt hoa thường", async () => {
    await expectJson(await wf({ auth: "bearer app-mock-ok", body: WF_BODY }), 200, WF_OK);
  });
});

describe("ADM-NFR-06 · M0-AC15 · B. Dify unauthorized", () => {
  it("ADM-NFR-06 · M0-AC15 · app-mock-401 + body sai → 401 (kịch bản thắng validate)", async () => {
    await expectJson(await wf({ auth: "Bearer app-mock-401", body: {} }), 401, D401);
  });

  it("ADM-NFR-06 · M0-AC15 · thiếu Authorization → 401 ở workflows/run và parameters", async () => {
    await expectJson(await wf({ body: WF_BODY }), 401, D401);
    await expectJson(await call(dify, "GET", "/v1/parameters"), 401, D401);
  });

  it("ADM-NFR-06 · M0-AC15 · Authorization không dạng Bearer <token> → 401", async () => {
    for (const auth of ["Basic YTpi", "app-mock-ok", "Bearer"]) {
      await expectJson(await wf({ auth, body: WF_BODY }), 401, D401);
    }
  });
});

describe("ADM-NFR-06 · M0-AC15 · C. Dify 400 invalid_param", () => {
  it("ADM-NFR-06 · M0-AC15 · body rỗng: workflows báo inputs, chat báo query", async () => {
    await expectJson(await wf({ auth: OK, body: {} }), 400, d400("inputs is required"));
    await expectJson(await chat({ auth: OK, body: {} }), 400, d400("query is required"));
  });

  it("ADM-NFR-06 · M0-AC15 · thiếu đúng một trường → báo trường đó", async () => {
    const { user: _u, ...noUser } = WF_BODY;
    await expectJson(await wf({ auth: OK, body: noUser }), 400, d400("user is required"));
    const { inputs: _i, ...noInputs } = CHAT_BODY;
    await expectJson(await chat({ auth: OK, body: noInputs }), 400, d400("inputs is required"));
  });

  it("ADM-NFR-06 · M0-AC15 · inputs null / mảng / chuỗi → inputs is required", async () => {
    for (const inputs of [null, [], "x"]) {
      const res = await wf({ auth: OK, body: { ...WF_BODY, inputs } });
      await expectJson(res, 400, d400("inputs is required"));
    }
  });

  it("ADM-NFR-06 · M0-AC15 · response_mode streaming → must be blocking; thiếu → is required", async () => {
    const streaming = await wf({ auth: OK, body: { ...WF_BODY, response_mode: "streaming" } });
    await expectJson(streaming, 400, d400("response_mode must be blocking"));
    const { response_mode: _r, ...noMode } = WF_BODY;
    await expectJson(await wf({ auth: OK, body: noMode }), 400, d400("response_mode is required"));
  });

  it("ADM-NFR-06 · M0-AC15 · body không phải JSON → như {}", async () => {
    await expectJson(
      await wf({ auth: OK, raw: "khong-phai-json" }),
      400,
      d400("inputs is required"),
    );
  });
});

describe("ADM-NFR-06 · M0-AC15 · D. Dify header X-Mock-Scenario (T-MOCK-1)", () => {
  it("ADM-NFR-06 · M0-AC15 · unauthorized + token ok → 401", async () => {
    await expectJson(await wf({ auth: OK, scenario: "unauthorized", body: WF_BODY }), 401, D401);
  });

  it("ADM-NFR-06 · M0-AC15 · ok thắng token 401 và thắng việc thiếu Authorization", async () => {
    const a = await wf({ auth: "Bearer app-mock-401", scenario: "ok", body: WF_BODY });
    await expectJson(a, 200, WF_OK);
    await expectJson(await wf({ scenario: "ok", body: WF_BODY }), 200, WF_OK);
  });

  it("ADM-NFR-06 · M0-AC15 · giá trị lạ / rỗng / sai hoa thường bị bỏ qua, chọn theo token", async () => {
    const cases: [string, string, number][] = [
      ["khac", "Bearer app-mock-401", 401],
      ["khac", OK, 200],
      ["", "Bearer app-mock-401", 401],
      ["OK", "Bearer app-mock-401", 401],
    ];
    for (const [scenario, auth, status] of cases) {
      const res = await wf({ auth, scenario, body: WF_BODY });
      await expectJson(res, status, status === 200 ? WF_OK : D401);
    }
  });

  it("ADM-NFR-06 · M0-AC15 · timeout + token ok → chờ như kịch bản timeout", async () => {
    const { res, ms } = await timed(() => wf({ auth: OK, scenario: "timeout", body: WF_BODY }));
    await expectJson(res, 200, WF_OK);
    expect(ms).toBeGreaterThanOrEqual(MIN_WAIT_MS);
    const name = await abortedName(
      `http://localhost:${difySrv.port}/v1/workflows/run`,
      { Authorization: OK, "X-Mock-Scenario": "timeout" },
      WF_BODY,
    );
    expect(["TimeoutError", "AbortError"]).toContain(name);
  });
});

describe("ADM-NFR-06 · M0-AC15 · E. Dify timeout (chờ trước, rồi mới validate)", () => {
  it("ADM-NFR-06 · M0-AC15 · client huỷ được request đang chờ", async () => {
    const name = await abortedName(
      `http://localhost:${difySrv.port}/v1/workflows/run`,
      { Authorization: "Bearer app-mock-timeout" },
      WF_BODY,
    );
    expect(["TimeoutError", "AbortError"]).toContain(name);
  });

  it("ADM-NFR-06 · M0-AC15 · không huỷ → 200 body ok sau ≥ 45 ms", async () => {
    const { res, ms } = await timed(() => wf({ auth: "Bearer app-mock-timeout", body: WF_BODY }));
    await expectJson(res, 200, WF_OK);
    expect(ms).toBeGreaterThanOrEqual(MIN_WAIT_MS);
  });

  it("ADM-NFR-06 · M0-AC15 · body sai → 400 chỉ sau khi đã chờ", async () => {
    const { res, ms } = await timed(() => wf({ auth: "Bearer app-mock-timeout", body: {} }));
    await expectJson(res, 400, d400("inputs is required"));
    expect(ms).toBeGreaterThanOrEqual(MIN_WAIT_MS);
  });
});

describe("ADM-NFR-06 · M0-AC15 · F. Hub GET /health", () => {
  it("ADM-NFR-06 · M0-AC15 · không qua middleware kịch bản: luôn 200 {status:ok, version:mock}", async () => {
    const body = { status: "ok", version: "mock" };
    await expectJson(await call(hub, "GET", "/health"), 200, body);
    await expectJson(await call(hub, "GET", "/health", { auth: "Bearer mock-401" }), 200, body);
    const sc = await call(hub, "GET", "/health", { scenario: "unauthorized" });
    await expectJson(sc, 200, body);
  });

  it("ADM-NFR-06 · M0-AC15 · token mock-timeout không làm /health phải chờ", async () => {
    const { res, ms } = await timed(() =>
      call(hub, "GET", "/health", { auth: "Bearer mock-timeout" }),
    );
    await expectJson(res, 200, { status: "ok", version: "mock" });
    expect(ms).toBeLessThan(MIN_WAIT_MS);
  });
});

describe("ADM-NFR-06 · M0-AC15 · G. Hub POST /internal/test-run", () => {
  it("ADM-NFR-06 · M0-AC15 · mock-ok + {command, inputs} → 200 body cố định có trace: []", async () => {
    await expectJson(await run({ auth: HOK, body: RUN_BODY }), 200, RUN_OK);
  });

  it("ADM-NFR-06 · M0-AC15 · không kiểm trường bên trong command", async () => {
    await expectJson(await run({ auth: HOK, body: { ...RUN_BODY, command: {} } }), 200, RUN_OK);
  });

  it("ADM-NFR-06 · M0-AC15 · validate theo thứ tự command → inputs, báo trường đầu tiên sai", async () => {
    const cmd = h400("command không hợp lệ");
    const inp = h400("inputs không hợp lệ");
    const cases: [unknown, unknown][] = [
      [{}, cmd],
      [{ inputs: { text: "a" } }, cmd],
      [{ command: null, inputs: { text: "a" } }, cmd],
      [{ command: [], inputs: { text: "a" } }, cmd],
      [{ command: "x", inputs: { text: "a" } }, cmd],
      [{ command: {} }, inp],
      [{ command: {}, inputs: [] }, inp],
      [{ workflow_id: U, inputs: { text: "a" } }, cmd],
    ];
    for (const [body, expected] of cases) {
      await expectJson(await run({ auth: HOK, body }), 400, expected);
    }
  });

  it("ADM-NFR-06 · M0-AC15 · body không phải JSON → như {}", async () => {
    await expectJson(
      await run({ auth: HOK, raw: "khong-phai-json" }),
      400,
      h400("command không hợp lệ"),
    );
  });

  it("ADM-NFR-06 · M0-AC15 · mock-401 / thiếu Authorization / Basic → 401, kể cả body sai", async () => {
    for (const auth of ["Bearer mock-401", undefined, "Basic YTpi"]) {
      await expectJson(await run({ auth, body: RUN_BODY }), 401, H401);
      await expectJson(await run({ auth, body: {} }), 401, H401);
    }
  });
});

describe("ADM-NFR-06 · M0-AC15 · H. Hub GET /agent-grants/effective/:user_id", () => {
  const grants = (userId: string, auth = HOK) =>
    call(hub, "GET", `/agent-grants/effective/${userId}`, { auth });

  it("ADM-NFR-06 · M0-AC15 · user_id uuid (thường và hoa) → 200 body cố định", async () => {
    await expectJson(await grants(U), 200, GRANTS_OK);
    await expectJson(await grants(U.toUpperCase()), 200, GRANTS_OK);
  });

  it("ADM-NFR-06 · M0-AC15 · user_id không phải uuid → 400 user_id không hợp lệ", async () => {
    for (const bad of ["abc", "00000000-0000-7000-8000-0000000000c"]) {
      await expectJson(await grants(bad), 400, h400("user_id không hợp lệ"));
    }
  });

  it("ADM-NFR-06 · M0-AC15 · mock-401 → 401", async () => {
    await expectJson(await grants(U, "Bearer mock-401"), 401, H401);
  });
});

describe("ADM-NFR-06 · M0-AC15 · I. Hub X-Mock-Scenario và timeout", () => {
  it("ADM-NFR-06 · M0-AC15 · header hợp lệ thắng token; lạ / rỗng / sai hoa thường bị bỏ qua", async () => {
    const cases: [string | undefined, string, number][] = [
      [HOK, "unauthorized", 401],
      ["Bearer mock-401", "ok", 200],
      [undefined, "ok", 200],
      ["Bearer mock-401", "khac", 401],
      [HOK, "khac", 200],
      ["Bearer mock-401", "", 401],
      ["Bearer mock-401", "OK", 401],
    ];
    for (const [auth, scenario, status] of cases) {
      const res = await run({ auth, scenario, body: RUN_BODY });
      await expectJson(res, status, status === 200 ? RUN_OK : H401);
    }
  });

  it("ADM-NFR-06 · M0-AC15 · mock-timeout: client huỷ được", async () => {
    const name = await abortedName(
      `http://localhost:${hubSrv.port}/internal/test-run`,
      { Authorization: "Bearer mock-timeout" },
      RUN_BODY,
    );
    expect(["TimeoutError", "AbortError"]).toContain(name);
  });

  it("ADM-NFR-06 · M0-AC15 · mock-timeout không huỷ → 200 sau ≥ 45 ms; body sai → 400 sau khi chờ", async () => {
    const ok = await timed(() => run({ auth: "Bearer mock-timeout", body: RUN_BODY }));
    await expectJson(ok.res, 200, RUN_OK);
    expect(ok.ms).toBeGreaterThanOrEqual(MIN_WAIT_MS);
    const bad = await timed(() => run({ auth: "Bearer mock-timeout", body: {} }));
    await expectJson(bad.res, 400, h400("command không hợp lệ"));
    expect(bad.ms).toBeGreaterThanOrEqual(MIN_WAIT_MS);
  });
});

describe("ADM-NFR-06 · M0-AC15 · J. path / method không tồn tại (spec §3.4)", () => {
  it("ADM-NFR-06 · M0-AC15 · Dify và Hub → 404 NOT_FOUND sau khi chọn kịch bản", async () => {
    await expectJson(await call(dify, "GET", "/v1/khong-co", { auth: OK }), 404, NOT_FOUND);
    await expectJson(await call(hub, "GET", "/khong-co", { auth: HOK }), 404, NOT_FOUND);
    await expectJson(
      await call(hub, "DELETE", "/internal/test-run", { auth: HOK }),
      404,
      NOT_FOUND,
    );
  });

  it("ADM-NFR-06 · M0-AC15 · path lạ với kịch bản unauthorized → 401 trước 404", async () => {
    const d = await call(dify, "GET", "/v1/khong-co", { auth: "Bearer app-mock-401" });
    await expectJson(d, 401, D401);
    await expectJson(await call(hub, "GET", "/khong-co", { auth: "Bearer mock-401" }), 401, H401);
  });
});
