// CR-127 · E10a (L1b) · spec §5.9 · lưu def có node «Xác nhận mốc» mang cấu hình giao việc ở `after` kiểu Duyệt (Ai làm / Cần /
// Quá hạn chuyển cho / Nhắc) ⇒ 200, đọc lại giữ nguyên; bước chờ thường mang `after` review ⇒ vẫn 422 WAIT_INVALID; phòng khác
// công ty ⇒ 422 như khối Duyệt. Hono thật `defsRoutes` + DB thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { department, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "./defs.routes";

const X = tenantId(1275);
const Y = tenantId(1276);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: userId(1275), tenantId: X, role: "platform_admin" }, // E8 · ghi def chỉ quản trị nền tảng,
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let G: string;
let GY: string;

async function call(method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": "A" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const codeOf = (r: { json: Json }) => r.json.error?.code ?? r.json.code;

const reviewAfter = (group: string) => ({
  kind: "review",
  group_id: group,
  back_to_steps: [],
  remind_every_h: 8,
  escalate: { after_h: 48, user_id: userId(1275) },
  branch: [],
  exclude_starter: false,
  need: "head",
});
const waitStage = (after: object, node?: string) => ({
  key: "xac-nhan-moc",
  name: "Xác nhận mốc",
  step: 0,
  ...(node ? { node } : {}),
  executor: {
    kind: "wait_event",
    event: "milestone.confirmed",
    also_events: ["milestone.task_cancelled"],
    timeout_h: 2160,
  },
  instruction: "",
  output: { filename: "xac-nhan-moc.md", template: "# x", required_sections: ["x"], fields: [] },
  after,
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
});
const body = (key: string, stages: object[]) => ({
  key,
  name: key,
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
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1275', 'X'), (${Y}, 't1276', 'Y')`;
  const [a] = await users(o, X, 1, { from: 1275 });
  const [y] = await users(o, Y, 1, { from: 1276 });
  G = await department(o, X, "pb-1275", { head: a as string, members: [a as string] });
  GY = await department(o, Y, "pb-1276", { head: y as string, members: [y as string] });
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
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E10a · lưu cấu hình node Xác nhận mốc", () => {
  it("Xác nhận mốc + after review ⇒ 200; đọc lại giữ Ai làm / Cần / Quá hạn / Nhắc", async () => {
    const node = "contracts.milestone-confirm";
    const r = await call(
      "POST",
      `/process-defs?tenant_id=${X}`,
      body("ms-ok", [waitStage(reviewAfter(G), node)]),
    );
    expect([r.status, codeOf(r)]).toEqual([201, undefined]);
    const id = r.json.id as string;
    const put = await call("PUT", `/process-defs/${id}?tenant_id=${X}`, {
      ...body("ms-ok", [waitStage({ ...reviewAfter(G), remind_every_h: 12 }, node)]),
      version: r.json.version ?? 1,
    });
    expect(put.status).toBe(200);
    const g = await call("GET", `/process-defs/${id}?tenant_id=${X}`);
    const after = g.json.stages?.[0]?.after ?? g.json.def?.stages?.[0]?.after;
    expect(after).toMatchObject({
      kind: "review",
      group_id: G,
      need: "head",
      remind_every_h: 12,
      escalate: { after_h: 48, user_id: userId(1275) },
    });
  });

  it("bước chờ thường mang after review ⇒ vẫn 422 WAIT_INVALID ở stages.0.after", async () => {
    const r = await call(
      "POST",
      `/process-defs?tenant_id=${X}`,
      body("ms-plain", [waitStage(reviewAfter(G))]),
    );
    expect([r.status, codeOf(r)]).toEqual([422, "PROCESS_DEF_INVALID"]);
    expect(JSON.stringify(r.json)).toContain("stages.0.after");
  });

  it("phòng của công ty khác ⇒ 422 như khối Duyệt", async () => {
    const node = "contracts.milestone-confirm";
    const r = await call(
      "POST",
      `/process-defs?tenant_id=${X}`,
      body("ms-cross", [waitStage(reviewAfter(GY), node)]),
    );
    expect(r.status).toBe(422);
  });
});
