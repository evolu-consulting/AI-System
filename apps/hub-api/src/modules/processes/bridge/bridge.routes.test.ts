// CR-122 · N2 · FLOW2-FR-26 · `POST /process-defs/bridge-suggest` (Hono thật, cache cấu hình giả, Agent Hub GIẢ — không DB, không AI thật):
// chỉ gửi tên/kiểu trường; đề xuất hợp lệ ⇒ stage `set` đã chèn thử sạch lệch; AI sai/không khớp/lỗi ⇒ `ok:false` + lý do; vai/tenant/tần suất.
import { describe, expect, test } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { BridgeSuggestResponseSchema } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import type { AgentCaller } from "../../../lib/ai-client/agent-call";
import type { AuthVars } from "../../../lib/auth.middleware";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { bridgeRoutes } from "./bridge.routes";

// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
const X = "00000000-0000-4000-8000-000000001291";
const Y = "00000000-0000-4000-8000-000000001292";
const view = {
  catalog: async () => ({
    features: [{ id: "f1", key: "contracts-write", status: "on" }],
    entitled: new Set([`${X}:f1`]),
    grantGroups: new Map(),
  }),
  user: async () => undefined,
};
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: "00000000-0000-4000-8000-000000001293", tenantId: X, role: "tenant_admin" },
  P: { userId: "00000000-0000-4000-8000-000000001294", tenantId: X, role: "platform_admin" },
  M: { userId: "00000000-0000-4000-8000-000000001295", tenantId: X, role: "member" },
};

type Call = Parameters<AgentCaller["call"]>[0];
type Reply = Awaited<ReturnType<AgentCaller["call"]>>;
function mount(reply: () => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const bridgeAgent = {
    call: async (r: Call) => {
      calls.push(r);
      return reply();
    },
  };
  const app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  app.route("/", bridgeRoutes({ config: view, bridgeAgent } as unknown as ProcessDeps));
  return { app, calls };
}
const ok = (text: string): Reply => ({
  ok: true,
  text,
  model: "m",
  usage: { inputTokens: 1, outputTokens: 1 } as never,
});
const GOOD = JSON.stringify({
  ok: true,
  values: [{ key: "contract_id", type: "string", from: { input: "contract-id" } }],
  explain_vi: "Lấy mã hợp đồng từ đầu vào của lượt chạy.",
  explain_en: "Takes the contract id from the run input.",
});

const stage = (key: string, step: number, extra: object = {}) => ({
  key,
  name: key.toUpperCase(),
  step,
  executor: { kind: "set", values: [{ key: "x", from: { const: "1" } }] },
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: "x",
    required_sections: ["x"],
    fields: [{ key: "x", type: "string", required: false }],
  },
  after: { kind: "auto", branch: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  ...extra,
});
const def = (stages: object[]) => ({
  key: "n2-flow",
  name: "N2",
  description: "",
  input_hint: "",
  run_group_ids: [],
  stages,
  token_budget: null,
  enabled: true,
  sources: [],
  inputs: [{ key: "contract-id", label: "Hợp đồng", type: "text", required: true }],
});
const GAP = [stage("dau", 0), stage("ky", 1, { node: "contracts.esign" })];
const body = (o: object = {}) => ({ def: def(GAP), from: "dau", to: "ky", ...o });

async function post(app: Hono<AuthVars>, who: string, b: unknown, q = "") {
  const r = await app.request(`/process-defs/bridge-suggest${q}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-who": who },
    body: JSON.stringify(b),
  });
  return { status: r.status, json: (await r.json()) as Json };
}

describe("CR-122 N2 · gợi ý cầu nối", () => {
  test("đề xuất hợp lệ ⇒ stage set (bước 1), giải thích vi+en, qua Agent Hub, prompt chỉ có tên/kiểu trường", async () => {
    const { app, calls } = mount(() => ok(`\`\`\`json\n${GOOD}\n\`\`\``));
    const r = await post(app, "A", body());
    expect(r.status).toBe(200);
    expect(BridgeSuggestResponseSchema.safeParse(r.json).success).toBe(true);
    if (!r.json.ok) throw new Error("expected ok");
    expect(r.json.stage.step).toBe(1);
    expect(r.json.stage.executor).toMatchObject({ kind: "set" });
    expect(r.json.explain_vi).toContain("hợp đồng");
    expect(calls).toHaveLength(1);
    const c = calls[0] as Call;
    expect([c.agentKey, c.feature, c.tenantId]).toEqual(["flow-bridge", "flow.bridge", X]);
    expect(c.signal).toBeInstanceOf(AbortSignal);
    const p = JSON.parse(c.prompt);
    expect(Object.keys(p).sort()).toEqual(["from", "mismatch", "run_inputs", "to"]);
    expect(p.mismatch.missing).toEqual(["contract_id"]);
    expect(p.run_inputs).toEqual([{ key: "contract-id", type: "string" }]);
    expect(c.prompt).not.toContain("DAU"); // không đưa tên/nội dung do người dùng đặt
  });

  test("hai bước đã khớp ⇒ ok:false, không gọi AI, cạnh không có thật ⇒ 400", async () => {
    const { app, calls } = mount(() => ok(GOOD));
    const fine = def([
      stage("dau", 0, {
        output: {
          ...stage("d", 0).output,
          fields: [{ key: "contract_id", type: "string", required: true }],
        },
      }),
      stage("ky", 1, { node: "contracts.esign" }),
    ]);
    const r = await post(app, "A", body({ def: fine }));
    expect(r.json.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect((await post(app, "A", body({ from: "ky", to: "dau" }))).status).toBe(400);
  });

  test("AI nói không map được ⇒ giữ lý do, AI trả sai hình / map sai kiểu / lỗi / hết trần ⇒ ok:false", async () => {
    const no = JSON.stringify({
      ok: false,
      reason_vi: "Không có đầu vào cùng kiểu.",
      reason_en: "No input of that type.",
    });
    const wrongType = JSON.stringify({
      ...JSON.parse(GOOD),
      values: [{ key: "contract_id", type: "number", from: { const: 5 } }],
    });
    const cases: [string, () => Reply | Promise<Reply>][] = [
      ["Không có đầu vào cùng kiểu.", () => ok(no)],
      ["không dùng được", () => ok(wrongType)],
      ["không dùng được", () => ok("xin chào")],
      ["chưa trả lời được", () => ({ ok: false, code: "FAILED" })],
      ["hết hạn mức", () => ({ ok: false, code: "CAP_EXCEEDED" })],
      ["chưa sẵn sàng", () => ({ ok: false, code: "UNAVAILABLE" })],
      [
        "chưa trả lời được",
        () => {
          throw new Error("boom");
        },
      ],
    ];
    for (const [needle, reply] of cases) {
      const r = await post(mount(reply).app, "A", body());
      expect(r.status).toBe(200);
      expect(r.json.ok).toBe(false);
      expect(!r.json.ok && r.json.reason_vi).toContain(needle);
    }
  });

  test("vai + tenant: member 403, tenant_admin sang tenant khác 404, platform_admin chọn tenant, tần suất 10/phút ⇒ 429", async () => {
    const { app } = mount(() => ok(GOOD));
    expect((await post(app, "M", body())).status).toBe(403);
    expect((await post(app, "A", body(), `?tenant_id=${Y}`)).status).toBe(404);
    // platform_admin + tenant X ⇒ thấy node Ký số của X; không chọn tenant (Thư viện) ⇒ mọi node ⇒ cũng thấy
    expect((await post(app, "P", body(), `?tenant_id=${X}`)).json.ok).toBe(true);
    expect((await post(app, "P", body())).json.ok).toBe(true);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post(app, "A", body())).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  test("tính năng Ký số chưa bật cho công ty ⇒ node không có trong bảng ⇒ không có lệch để cầu nối", async () => {
    const off = {
      ...view,
      catalog: async () => ({ ...(await view.catalog()), entitled: new Set<string>() }),
    };
    const app = new Hono<AuthVars>();
    app.use("*", async (c, next) => {
      c.set("user", WHO.A as never);
      await next();
    });
    app.onError((e, c) => c.json(mapError(e).body, mapError(e).status));
    app.route("/", bridgeRoutes({ config: off } as unknown as ProcessDeps));
    const r = await post(app, "A", body());
    expect(r.json.ok).toBe(false); // khớp (không đòi gì) — không phải lỗi, không gọi AI (agent vắng)
  });
});
