// CR-122 · G2 · int: tenant_admin sao chép flow Thư viện THEO SỰ KIỆN (có `trigger`, không khe) cho công ty mình ⇒ bản riêng có
// trigger + app + stages, nguồn + bản xuất bản được ghi, CHƯA xuất bản; xem chỉ-đọc trả trigger/app.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/domain/approval-slot-default.rules";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "../defs/defs.routes";
import { libraryRoutes } from "./library.routes";

const X = tenantId(1221);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: userId(1221), tenantId: X, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let flowId = "";

async function call(method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": "A" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1221', 'Công ty X')`;
  await users(o, X, 1, { from: 1221 });
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description,
      input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, trigger, app, published_version)
    select null, 'flow-g2', 'Flow G2', 'mô tả', input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs,
      null, null, '{"event":"contract.submitted"}'::jsonb, 'contracts', 1
    from hub.process_defs where id = ${APPROVAL_DEFAULT_DEF.id} returning id::text as id`;
  flowId = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    select ${flowId}, 1, 'Flow G2', stages, null from hub.process_defs where id = ${flowId}`;
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  const deps = { db, packTools: {}, start: {} } as unknown as ProcessDeps;
  app.route("/", defsRoutes(deps));
  app.route("/", libraryRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 G2 · sao chép flow có trigger", () => {
  it("xem chỉ-đọc trả trigger; sao chép 201 ⇒ bản riêng có trigger/app/stages, chưa xuất bản", async () => {
    const v = await call("GET", `/tenants/${X}/process-library/${flowId}`);
    expect(v.status).toBe(200);
    expect(v.json.slot).toBeNull();
    expect(v.json.trigger).toEqual({ event: "contract.submitted" });
    const c = await call("POST", `/tenants/${X}/process-defs/${flowId}/clone-for-company`, {});
    expect(c.status).toBe(201);
    const [row] =
      await o`select tenant_id::text as t, slot, trigger, app, enabled, published_version as pv,
        source_template_id::text as src, source_rel_version as rel, jsonb_array_length(stages)::int as n
      from hub.process_defs where id = ${c.json.def_id}`;
    expect(row?.t).toBe(X);
    expect(row?.slot).toBeNull();
    expect(row?.trigger).toEqual({ event: "contract.submitted" });
    expect(row?.app).toBe("contracts");
    expect(row?.enabled).toBe(false);
    expect(row?.pv).toBeNull();
    expect(row?.src).toBe(flowId);
    expect(Number(row?.rel)).toBe(1);
    expect(Number(row?.n)).toBeGreaterThan(0);
  });
});
