// CR-127 · Z7 · int (Hono thật defs + company-flows + DB thật): xoá quy trình CÔNG TY chỉ khi còn NHÁP (chưa áp dụng, chưa có lượt chạy):
// tạo từ sơ đồ trống ⇒ xoá được (204, gỡ dòng company_flows cùng tx); quản trị công ty 403; đã áp dụng ⇒ 409 PROCESS_NOT_DELETABLE {applied};
// nháp đã có lượt chạy ⇒ 409 {has_runs}; danh sách báo `deletable` đúng từng ca.
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
import { companyFlowsRoutes } from "../library/company-flows.routes";
import { seedCompanyFlow } from "../testing/company-flow-seed";
import { defsRoutes } from "./defs.routes";

const X = tenantId(1271);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1270), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1271), tenantId: X, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const LIST = `/tenants/${X}/company-flows`;
const rowOf = async (flowId: string) =>
  ((await call("P", "GET", LIST)).json.items as Json[]).find((x) => x.flow_id === flowId);
const del = (who: string, flowId: string, version: number) =>
  call(who, "DELETE", `/process-defs/${flowId}?tenant_id=${X}&version=${version}`);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1271', 'X')`;
  await users(o, X, 2, { from: 1270 });
  const deps = { db } as unknown as ProcessDeps;
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
  app.route("/", defsRoutes(deps));
  app.route("/", companyFlowsRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 Z7 · xoá quy trình nháp của công ty", () => {
  it("tạo từ sơ đồ trống ⇒ deletable; quản trị công ty 403; platform xoá 204, gỡ dòng company_flows, biến khỏi danh sách", async () => {
    const made = await call("P", "POST", LIST, {
      name: "Nháp xoá",
      app: "contracts",
      from: "blank",
    });
    expect(made.status).toBe(201);
    const id = made.json.flow_id as string;
    const row = await rowOf(id);
    expect(row).toMatchObject({ deletable: true, enabled: false, kind: "company" });
    expect((await del("A", id, row?.def_version)).status).toBe(403);
    expect(await rowOf(id)).toBeDefined(); // chưa xoá
    const ok = await del("P", id, row?.def_version);
    expect(ok.status).toBe(204);
    expect(await rowOf(id)).toBeUndefined();
    const [n] = await o<
      { cf: number; gone: boolean }[]
    >`select (select count(*)::int from hub.company_flows where flow_id = ${id}) as cf,
        (select deleted_at is not null from hub.process_defs where id = ${id}) as gone`;
    expect(n).toEqual({ cf: 0, gone: true });
  });

  it("đã áp dụng ⇒ 409 PROCESS_NOT_DELETABLE (applied), không xoá gì, deletable=false", async () => {
    const s = await seedCompanyFlow(o, {
      tenantId: X,
      key: "z7-applied",
      trigger: { event: "contract.submitted" },
    });
    const row = await rowOf(s.flowId);
    expect(row).toMatchObject({ deletable: false, enabled: true });
    const r = await del("P", s.flowId, row?.def_version);
    expect([r.status, r.json.error?.code, r.json.error?.details?.reason]).toEqual([
      409,
      "PROCESS_NOT_DELETABLE",
      "applied",
    ]);
    expect(await rowOf(s.flowId)).toBeDefined();
  });

  it("nháp nhưng đã có lượt chạy ⇒ 409 (has_runs), deletable=false, dòng company_flows giữ nguyên", async () => {
    const s = await seedCompanyFlow(o, {
      tenantId: X,
      key: "z7-runs",
      trigger: { event: "contract.submitted" },
      applied: false,
    });
    expect((await rowOf(s.flowId))?.deletable).toBe(true);
    const run = crypto.randomUUID();
    await o.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
          conversation_id, flow_id, status)
        values (${run}, ${X}, ${s.flowId}, 1, '{}'::jsonb, ${userId(1270)}, 'admin', '', ${run}, ${run}, 'done')`;
    });
    const row = await rowOf(s.flowId);
    expect(row?.deletable).toBe(false);
    const r = await del("P", s.flowId, row?.def_version);
    expect([r.status, r.json.error?.code, r.json.error?.details?.reason]).toEqual([
      409,
      "PROCESS_NOT_DELETABLE",
      "has_runs",
    ]);
    expect(await rowOf(s.flowId)).toBeDefined();
  });
});
