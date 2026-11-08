// CR-125 · cr125-manual-start-engine · int (Hono thật + DB thật + engine thật `flowLaunchOf` → `StartService`): bắt đầu quy trình bằng
// phiếu yêu cầu. Người được phép ⇒ mở lượt, giá trị phiếu vào input của lượt; người không thuộc nhóm ⇒ 403 START_NOT_ALLOWED; phiếu sai
// ⇒ 422 kèm lỗi theo ô; cờ công ty tắt ⇒ 409 START_FLOW_OFF; gửi trùng cùng request_id ⇒ một lượt; công ty khác không thấy/không bắt đầu.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { withHubScope } from "@ai/db/hub-scope";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { setFlowTriggers } from "./flags";
import { manualStartRoutes } from "./manual-start.routes";

const X = tenantId(1291);
const Y = tenantId(1292);
const G_BUY = "0b000000-0000-4000-8000-000000001291";
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: userId(1291), tenantId: X, role: "member" }, // trong nhóm mua hàng
  B: { userId: userId(1292), tenantId: X, role: "member" }, // không trong nhóm
  O: { userId: userId(1293), tenantId: Y, role: "tenant_admin" }, // công ty khác
};
const GROUPS: Record<string, string[]> = { [userId(1291)]: [G_BUY] };
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;

const START_STAGE = {
  key: "phieu",
  name: "Bắt đầu bằng phiếu yêu cầu",
  step: 0,
  node: "core.start-form",
  executor: { kind: "set", values: [] },
  instruction: "",
  output: { filename: "p.md", template: "# p", required_sections: ["p"], fields: [] },
  after: { kind: "auto", branch: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  start_form: {
    fields: [
      { key: "item", label: "Hàng cần mua", type: "text", required: true },
      { key: "amount", label: "Số tiền", type: "money", required: true },
      { key: "need_by", label: "Cần trước ngày", type: "date", required: false },
    ],
    starters: { kind: "groups", group_ids: [G_BUY] },
    title_template: "Đề xuất mua {{item}}",
  },
};

const call = async (who: string, method: string, path: string, body?: unknown) => {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : {} };
};
const codeOf = (j: { error?: { code?: string }; code?: string }) => j.error?.code ?? j.code;
const start = (who: string, request_id: string, values: Record<string, unknown>) =>
  call(who, "POST", "/processes/start", { flow_key: "mua-hang", request_id, values });
const GOOD = { item: "Máy in", amount: 12_500_000, need_by: "2026-12-01" };
const rid = (n: number) => `0c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1291', 'X'), (${Y}, 't1292', 'Y')`;
  await users(o, X, 2, { from: 1291 });
  await users(o, Y, 1, { from: 1293 });
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, enabled)
    values (${X}, 'mua-hang', 'Mua hàng', ${JSON.stringify([START_STAGE])}::text::jsonb, true) returning id::text as id`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${d?.id as string}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, X, true));
  const deps = {
    db,
    config: {
      user: async (id: string) => ({ active: true, groupIds: new Set(GROUPS[id] ?? []) }),
      poll: async () => {},
    },
    launcher: { kick: async () => {} },
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps;
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  app.route("/", manualStartRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 · bắt đầu quy trình bằng phiếu yêu cầu", () => {
  it("người trong nhóm thấy flow + phiếu, bắt đầu ⇒ một lượt với input là giá trị phiếu, gửi trùng ⇒ cùng lượt", async () => {
    const list = await call("A", "GET", "/processes/startable");
    expect(list.status).toBe(200);
    expect(list.json.items.map((x: { flow_key: string }) => x.flow_key)).toEqual(["mua-hang"]);
    expect(list.json.items[0].form.fields.map((f: { key: string }) => f.key)).toEqual([
      "item",
      "amount",
      "need_by",
    ]);
    const r = await start("A", rid(1), GOOD);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ created: true, title: "Đề xuất mua Máy in" });
    const [run] = await o<
      { inputs: { key: string; text?: string; value?: string }[]; by: string }[]
    >`
      select inputs, started_by::text as by from hub.process_runs where id = ${r.json.run_id}`;
    expect(run?.by).toBe(WHO.A?.userId as string);
    const byKey = Object.fromEntries((run?.inputs ?? []).map((i) => [i.key, i.text ?? i.value]));
    expect(byKey).toMatchObject({
      item: "Máy in",
      amount: "12500000",
      need_by: "2026-12-01",
      request_title: "Đề xuất mua Máy in",
    });
    const again = await start("A", rid(1), GOOD);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ run_id: r.json.run_id, created: false });
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.process_runs r
      join hub.flow_events e on e.id = r.flow_event_id where e.tenant_id = ${X} and e.event_id = ${`start:${rid(1)}`}`;
    expect(n?.n).toBe(1);
  });

  it("người không trong nhóm ⇒ 403 START_NOT_ALLOWED, không thấy trong danh sách", async () => {
    expect((await call("B", "GET", "/processes/startable")).json.items).toEqual([]);
    const r = await start("B", rid(2), GOOD);
    expect(r.status).toBe(403);
    expect(codeOf(r.json)).toBe("START_NOT_ALLOWED");
  });

  it("phiếu sai ⇒ 422 START_FORM_INVALID kèm lỗi theo ô, không mở lượt", async () => {
    const r = await start("A", rid(3), { amount: -5, extra: "x" });
    expect(r.status).toBe(422);
    expect(codeOf(r.json)).toBe("START_FORM_INVALID");
    const f = (r.json.error?.details ?? r.json.details).fields;
    expect(Object.keys(f).sort()).toEqual(["amount", "extra", "item"]);
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where tenant_id = ${X} and event_id = ${`start:${rid(3)}`}`;
    expect(n?.n).toBe(0);
  });

  it("công ty khác không thấy, không bắt đầu được flow của X", async () => {
    expect((await call("O", "GET", "/processes/startable")).json.items).toEqual([]);
    const r = await start("O", rid(4), GOOD);
    expect(r.status).toBe(404);
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.flow_events where event_id = ${`start:${rid(4)}`}`;
    expect(n?.n).toBe(0);
  });

  it("cờ quy trình của công ty tắt ⇒ 409 START_FLOW_OFF, danh sách rỗng", async () => {
    await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, X, false));
    try {
      expect((await call("A", "GET", "/processes/startable")).json.items).toEqual([]);
      const r = await start("A", rid(5), GOOD);
      expect(r.status).toBe(409);
      expect(codeOf(r.json)).toBe("START_FLOW_OFF");
    } finally {
      await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, X, true));
    }
  });
});
