// CR-122 · E5b · FLOW2-FR-25 · lưu def có node Ký số cấu hình sai ⇒ 422 `FLOW_NODE_CONFIG_INVALID` + path (Hono thật `defsRoutes` + DB thật);
// validator do gói đăng ký ở kit (`nodeConfigRegistry`). Cấu hình đúng ⇒ qua bước kiểm node (lỗi sau đó, nếu có, không phải mã này).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { esignNodeValidator } from "../../packs/contracts/adapters/esign-node.validator";
import { nodeConfigRegistry } from "../../packs/kit/public";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "./defs.routes";

const X = tenantId(1241);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: userId(1241), tenantId: X, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
const checked: string[] = [];

async function call(method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": "A" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}

const stage = (key: string, step: number, extra: object = {}) => ({
  key,
  name: key.toUpperCase(),
  step,
  executor: { kind: "set", values: [{ key: "x", from: { const: "1" } }] },
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: "# x",
    required_sections: ["x"],
    fields: [{ key: "x", type: "string", required: false }],
  },
  after: { kind: "auto", branch: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  ...extra,
});
const esignStage = (args: Record<string, unknown>, withNode = true) =>
  stage("ky", 0, {
    ...(withNode ? { node: "contracts.esign" } : {}),
    real_action: true,
    executor: {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: { contract_id: { from: "const", value: "x" }, ...args },
    },
  });
/** Nửa sau của node Ký số (chờ ký xong): CR-123 FR-14 — node nhiều stage phải đi đủ cụm. */
const waitStage = (step = 1, key = "cho-ky") =>
  stage(key, step, {
    node: "contracts.esign",
    executor: {
      kind: "wait_event",
      event: "esign.completed",
      also_events: ["esign.declined", "esign.voided"],
      timeout_h: 168,
    },
  });
const body = (stages: object[]) => ({
  key: "e5b-ky-so",
  name: "Ký số",
  description: "",
  input_hint: "",
  run_group_ids: [],
  stages,
  token_budget: null,
  enabled: true,
  sources: [],
  inputs: [],
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1241', 'X')`;
  await users(o, X, 1, { from: 1241 });
  // Validator thật của gói; kiểm công ty giả (nhà cung cấp `nope` chưa bật) để không dựng cả module ký số.
  nodeConfigRegistry.registerTool(
    "contracts-esign-send",
    esignNodeValidator(async (t, cfg) => {
      checked.push(t);
      return cfg.provider === "nope" ? [{ field: "provider", code: "PROVIDER_UNAVAILABLE" }] : [];
    }),
  );
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return c.json(m.body, m.status);
  });
  const config = {
    catalog: async () => ({
      features: [{ id: "f1", key: "contracts-write", status: "on" }],
      entitled: new Set([`${X}:f1`]),
      grantGroups: new Map(),
    }),
    user: async () => undefined,
  };
  app.route(
    "/",
    defsRoutes({ db, packTools: undefined, start: {}, config } as unknown as ProcessDeps),
  );
}, 180_000);

afterAll(async () => {
  nodeConfigRegistry.clear("contracts-esign-send");
  await db?.close();
  await o?.end({ timeout: 2 });
});

const codeOf = (r: { json: Json }) => r.json.error?.code ?? r.json.code;

describe("E5b · lưu def kiểm cấu hình node", () => {
  it("nhà cung cấp chưa bật ⇒ 422 FLOW_NODE_CONFIG_INVALID + path, không lưu", async () => {
    const r = await call(
      "POST",
      "/process-defs",
      body([esignStage({ provider: { from: "const", value: "nope" } }), waitStage()]),
    );
    expect([r.status, codeOf(r)]).toEqual([422, "FLOW_NODE_CONFIG_INVALID"]);
    expect(JSON.stringify(r.json)).toContain("stages.0.executor.args.provider");
    expect(checked).toEqual([X]); // kiểm theo ĐÚNG công ty của người lưu
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.process_defs where key = 'e5b-ky-so'`;
    expect(n?.n).toBe(0);
  });

  it("sai dạng (thứ tự lạ) ⇒ 422 cùng mã, path đúng khoá", async () => {
    const r = await call(
      "POST",
      "/process-defs",
      body([esignStage({ order: { from: "const", value: "random" } }), waitStage()]),
    );
    expect([r.status, codeOf(r)]).toEqual([422, "FLOW_NODE_CONFIG_INVALID"]);
    expect(JSON.stringify(r.json)).toContain("stages.0.executor.args.order");
  });

  it("E5d · def gọi thẳng tool gửi ký KHÔNG mang `node` vẫn bị kiểm (validator theo khoá tool)", async () => {
    const r = await call(
      "POST",
      "/process-defs",
      body([esignStage({ provider: { from: "const", value: "nope" } }, false)]),
    );
    expect([r.status, codeOf(r)]).toEqual([422, "FLOW_NODE_CONFIG_INVALID"]);
    expect(JSON.stringify(r.json)).toContain("stages.0.executor.args.provider");
  });

  it("cấu hình đúng ⇒ không bị chặn bởi mã FLOW_NODE_CONFIG_INVALID", async () => {
    const r = await call(
      "POST",
      "/process-defs",
      body([esignStage({ provider: { from: "const", value: "misa" } }), waitStage()]),
    );
    expect(codeOf(r)).not.toBe("FLOW_NODE_CONFIG_INVALID");
    expect(codeOf(r)).not.toBe("FLOW_NODE_SPLIT");
  });
});

describe("CR-123 · u3a · FR-14 · lưu def mà node Ký số bị tách ⇒ 422 FLOW_NODE_SPLIT nói tên bước", () => {
  const split = [
    esignStage({}),
    stage("giua", 1), // stage lạ chen giữa cụm
    waitStage(2),
  ];
  const noSave = async () => {
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.process_defs where key = 'e5b-ky-so'`;
    return n?.n;
  };
  it("stage lạ chen giữa gửi và chờ ⇒ 422 + message có tên bước + cách sửa, không lưu", async () => {
    const r = await call("POST", "/process-defs", body(split));
    expect([r.status, codeOf(r)]).toEqual([422, "FLOW_NODE_SPLIT"]);
    const text = JSON.stringify(r.json);
    expect(text).toContain("Bước Ký số bị tách rời — xoá rồi thêm lại bước Ký số");
    expect(text).toContain("stages.0");
    expect(await noSave()).toBe(0);
  });
  it("thiếu nửa chờ (chỉ có bước gửi) ⇒ 422 FLOW_NODE_SPLIT", async () => {
    const r = await call("POST", "/process-defs", body([esignStage({})]));
    expect([r.status, codeOf(r)]).toEqual([422, "FLOW_NODE_SPLIT"]);
  });
});
