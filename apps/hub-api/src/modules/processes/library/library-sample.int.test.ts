// CR-105 · lọc mẫu · int `GET /process-defs`: danh sách chính = def thư viện (khe) + def của gói; "Mẫu · chạy thử" (`kind=sample`) =
// mẫu toàn nền tảng + def tenant KHÔNG khe, KHÔNG của gói (vd flow-showcase, bản "Chép mẫu"). Route Hono thật + DB thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "../defs/defs.routes";

const X = tenantId(1081);
const WHO = {
  A: { userId: userId(1081), tenantId: X, role: "tenant_admin" as Role },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;

const keys = async (query: string): Promise<string[]> => {
  const r = await app.request(`/process-defs?limit=100${query}`, { headers: { "x-who": "A" } });
  expect(r.status).toBe(200);
  return ((await r.json()) as Json).items.map((i: Json) => i.key);
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1081', 'Công ty X')`;
  await users(o, X, 1, { from: 1081 });
  await o`insert into hub.process_defs (tenant_id, key, name, stages) values (null, 'sm-template', 'Mẫu', '[{"key":"s0"}]')`;
  await o`insert into hub.process_defs (tenant_id, key, name, stages) values (${X}, 'sm-showcase', 'Showcase', '[{"key":"s0"}]')`;
  await o`insert into hub.process_defs (tenant_id, key, name, stages, pack_version) values (${X}, 'sm-pack', 'Của gói', '[{"key":"s0"}]', 1)`;
  await o`insert into hub.process_defs (tenant_id, key, name, stages, source_ref, pack_version)
    values (${X}, 'sm-materialized', 'Vật chất hoá', '[{"key":"s0"}]', '0123456789abcdef', 1)`;
  const deps = { db, packTools: {}, start: {} } as unknown as ProcessDeps;
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[(c.req.header("x-who") ?? "A") as "A"] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  app.route("/", defsRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-105 · lọc mẫu", () => {
  it("def tenant không khe, không của gói ⇒ có ở kind=sample, không ở danh sách mặc định", async () => {
    const sample = await keys("&kind=sample");
    const main = await keys("");
    const mine = (ks: string[]) => ks.filter((k) => k.startsWith("sm-")).sort();
    expect({ sample: mine(sample), main: mine(main) }).toEqual({
      sample: ["sm-showcase", "sm-template"],
      main: ["sm-pack"],
    });
  });
});
