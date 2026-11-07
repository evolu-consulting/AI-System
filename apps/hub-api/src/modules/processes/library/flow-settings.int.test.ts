// CR-122 · P7 · int (Hono thật + DB thật): GET/PUT /tenants/:tid/flow-settings — chỉ platform_admin; tenant_admin/member 403;
// đổi giá trị ghi audit (cũ → mới), đặt lại đúng giá trị cũ không ghi thêm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { companyFlowsRoutes } from "./company-flows.routes";

const X = tenantId(1271);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1270), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1271), tenantId: X, role: "tenant_admin" },
  M: { userId: userId(1272), tenantId: X, role: "member" },
  /** quản trị của công ty KHÁC */
  O: { userId: userId(1272), tenantId: tenantId(1272), role: "tenant_admin" },
};
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
const path = `/tenants/${X}/flow-settings`;
const call = async (who: string, method: string, body?: unknown) => {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : {} };
};
const auditRows = () =>
  o<
    { before: { flow_triggers: boolean }; after: { flow_triggers: boolean }; actor_id: string }[]
  >`select before, after, actor_id::text from hub.audit_log where tenant_id = ${X} and entity_name = 'flow_triggers' order by seq`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1271', 'X')`;
  await users(o, X, 3, { from: 1270 });
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  app.route("/", companyFlowsRoutes({ db } as unknown as ProcessDeps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 P7 · flow-settings", () => {
  it("CR-123 FR-09: member và quản trị công ty khác 403, quản trị công ty mình đọc/đổi được", async () => {
    expect((await call("M", "GET")).status).toBe(403);
    expect((await call("M", "PUT", { flow_triggers: true })).status).toBe(403);
    expect((await call("O", "GET")).status).toBe(403);
    expect((await call("O", "PUT", { flow_triggers: true })).status).toBe(403);
    expect((await call("A", "GET")).json).toEqual({ flow_triggers: false, has_active_flow: false });
  });
  it("CR-123 FR-09: chưa có quy trình đang áp dụng ⇒ 422 FLOW_NONE_ASSIGNED; gán xong thì quản trị công ty bật được", async () => {
    const refused = await call("A", "PUT", { flow_triggers: true });
    expect([refused.status, refused.json.error.code]).toEqual([422, "FLOW_NONE_ASSIGNED"]);
    expect((await call("A", "GET")).json.flow_triggers).toBe(false);
    const [d] = await o<{ id: string }[]>`insert into hub.process_defs
      (tenant_id, key, name, stages, trigger, app, published_version, enabled)
      values (null, 'fs1271', 'Duyệt HĐ', '[{"key":"s0"}]'::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true)
      returning id::text as id`;
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${d?.id as string}, true)`;
    expect((await call("A", "PUT", { flow_triggers: true })).json).toEqual({
      flow_triggers: true,
      has_active_flow: true,
    });
    expect((await call("A", "PUT", { flow_triggers: false })).json.flow_triggers).toBe(false);
  });
  it("platform_admin bật/tắt, audit ghi cũ và mới", async () => {
    expect((await call("P", "GET")).json).toEqual({ flow_triggers: false, has_active_flow: true });
    expect((await call("P", "PUT", { flow_triggers: true })).json.flow_triggers).toBe(true);
    expect((await call("P", "GET")).json.flow_triggers).toBe(true);
    await call("P", "PUT", { flow_triggers: true });
    expect((await call("P", "PUT", { flow_triggers: false })).json.flow_triggers).toBe(false);
    const rows = (await auditRows()).slice(-2);
    expect(rows.map((r) => [r.before.flow_triggers, r.after.flow_triggers])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(rows[0]?.actor_id).toBe(WHO.P?.userId as string);
  });
});
