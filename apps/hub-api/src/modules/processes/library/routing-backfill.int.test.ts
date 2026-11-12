// hub-routing-backfill · viết TRƯỚC code: tenant gán theo đường cũ phải hiện trong tập quy trình CR-118 (`process_tenant_defs`).
// (1) RLS theo tenant (0089/0090/0091 trên DB có gán cũ: `slot-single-source.int.test.ts`; cr120: gán cũ = luật mặc định).
// (2) PUT/DELETE `/tenants/:tid/process-slots/:slot` đồng bộ tập gán (bỏ gán giữ lại khi luật còn dùng). (3) GET routing trả
// `current_def_id` = quy trình chạy khi không có luật (gán cũ, không có ⇒ mặc định khe). Kiểm trạng thái DB thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { withHubScope } from "@ai/db/hub-scope";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { setSlotDefault } from "../../../test-support/slot-default";
import { intakeSlotSpec } from "../../packs/contracts/testing";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { ProcessDeps } from "../core/ports";
import { libraryRoutes } from "./library.routes";
import { INTAKE_DEFAULT_ID, INTAKE_SLOT, reviveIntakeDefault } from "./slot-generic.fixture";

const SLOT = INTAKE_SLOT;
const X = tenantId(1191);
const Y = tenantId(1192);
const Z = tenantId(1193);
const DFLT = INTAKE_DEFAULT_ID;
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1190), tenantId: X, role: "platform_admin" },
  AZ: { userId: userId(1193), tenantId: Z, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
const lib = { A: "", B: "", C: "" };

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const ROUTING = (t: string) => `/tenants/${t}/process-routing/${SLOT}`;
const LEGACY = (t: string) => `/tenants/${t}/process-slots/${SLOT}`;

async function libCopy(key: string, name: string): Promise<string> {
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    select null, ${key}, ${name}, description, input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs,
      slot, slot_body, 1 from hub.process_defs where id = ${DFLT} returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    select ${id}, 1, ${name}, stages, slot_body from hub.process_def_releases
    where def_id = ${DFLT} order by rel_version desc limit 1`;
  return id;
}

const setOf = async (t: string) => [
  ...(await o`select def_id::text as d, slot, assigned_by from hub.process_tenant_defs
    where tenant_id = ${t} order by def_id`),
];
beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name)
    values (${X}, 't1191', 'Cty X'), (${Y}, 't1192', 'Cty Y'), (${Z}, 't1193', 'Cty Z')`;
  await users(o, X, 1, { from: 1190 });
  await users(o, Z, 1, { from: 1193 });
  for (const t of [X, Y, Z]) await groups(o, t, ["contracts-editor", "contracts-owner"]);
  await reviveIntakeDefault(o);
  lib.A = await libCopy("bf-a", "QT A");
  lib.B = await libCopy("bf-b", "QT B");
  lib.C = await libCopy("bf-c", "QT C");
  slotRegistry.register(intakeSlotSpec);
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
  const packTools = { has: () => false, available: async () => [] };
  app.route("/", libraryRoutes({ db, packTools, start: {} } as unknown as ProcessDeps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("hub-routing-backfill · tập gán từ gán cũ (cr120-single-source: gán cũ = luật mặc định)", () => {
  it("seed: X gán A; Y gán B + đã có C trong tập (0089/0090 chạy trên DB thật kiểm ở slot-single-source.int.test.ts)", async () => {
    await setSlotDefault(o, X, SLOT, lib.A);
    await setSlotDefault(o, Y, SLOT, lib.B);
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot, assigned_by)
      values (${Y}, ${lib.C}, ${SLOT}, ${userId(1190)})`;
    expect((await setOf(X)).map((r) => r.d)).toEqual([lib.A]);
    expect(await setOf(Z)).toEqual([]);
    // RLS: scope user của X chỉ thấy hàng của X.
    const seen = await withHubScope(db, { kind: "user", tenantId: X, userId: userId(1190) }, (tx) =>
      tx.execute<{ t: string }>(
        sql`select distinct tenant_id::text as t from hub.process_tenant_defs`,
      ),
    );
    expect(seen.map((r) => r.t)).toEqual([X]);
  });
  it("GET routing: tenant gán cũ thấy quy trình + current_def_id, chưa gán ⇒ mặc định khe", async () => {
    const x = await call("P", "GET", ROUTING(X));
    expect(x.status).toBe(200);
    expect(x.json.processes.map((p: Json) => p.def_id)).toEqual([lib.A]);
    expect(x.json.current_def_id).toBe(lib.A);
    const z = await call("AZ", "GET", ROUTING(Z));
    expect(z.status).toBe(200);
    expect(z.json.processes).toEqual([]);
    expect(z.json.current_def_id).toBe(DFLT);
    expect(typeof z.json.current_def_name).toBe("string");
  });
});

describe("hub-routing-backfill · gán cũ đồng bộ tập gán", () => {
  it("PUT gán cũ ⇒ hiện trong routing, thay ⇒ bỏ def cũ khỏi tập, DELETE giữ def khi luật còn dùng", async () => {
    expect((await call("P", "PUT", LEGACY(Z), { def_id: lib.B })).status).toBe(200);
    let g = await call("AZ", "GET", ROUTING(Z));
    expect(g.json.processes.map((p: Json) => p.def_id)).toEqual([lib.B]);
    expect(g.json.current_def_id).toBe(lib.B);
    // thay B → C: B không có luật ⇒ ra khỏi tập
    expect((await call("P", "PUT", LEGACY(Z), { def_id: lib.C })).status).toBe(200);
    expect((await setOf(Z)).map((r) => r.d)).toEqual([lib.C]);
    // CR-120 · gán cũ = luật mặc định: PUT cũ đã ghi luật `is_default` C (đầu luật version tăng ⇒ PUT luật phải đọc version mới).
    g = await call("AZ", "GET", ROUTING(Z));
    expect(g.json.rules.map((r: Json) => [r.def_id, r.is_default])).toEqual([[lib.C, true]]);
    // luật phòng ban dùng C ⇒ bỏ gán cũ (xoá luật mặc định) vẫn giữ C trong tập (FK luật), không luật khớp ⇒ mẫu khe
    // CR-127 E8 · BR-10/11: ghi luật định tuyến chỉ quản trị nền tảng; quản trị công ty ⇒ 403
    const denied = await call("AZ", "PUT", ROUTING(Z), { version: g.json.version, rules: [] });
    expect([denied.status, denied.json.error?.code]).toEqual([403, "FORBIDDEN_TENANT_ADMIN_WRITE"]);
    const put = await call("P", "PUT", ROUTING(Z), {
      version: g.json.version,
      rules: [
        { condition: { contractKinds: ["buy"] }, def_id: lib.C, is_default: false },
        { condition: {}, def_id: lib.C, is_default: true },
      ],
    });
    expect(put.status).toBe(200);
    expect((await call("P", "DELETE", LEGACY(Z))).status).toBe(204);
    expect((await setOf(Z)).map((r) => r.d)).toEqual([lib.C]);
    g = await call("AZ", "GET", ROUTING(Z));
    expect(g.json.rules.map((r: Json) => r.is_default)).toEqual([false]);
    expect(g.json.current_def_id).toBe(DFLT);
    expect(
      (await o`select 1 from hub.process_routing_rules where is_default and tenant_id = ${Z}`)
        .length,
    ).toBe(0);
  });

  it("DELETE gán cũ không có luật ⇒ bỏ khỏi tập", async () => {
    expect((await call("P", "PUT", LEGACY(Y), { def_id: lib.A })).status).toBe(200);
    expect((await setOf(Y)).map((r) => r.d).sort()).toEqual([lib.A, lib.C].sort()); // B (cũ, không luật) ra
    expect((await call("P", "DELETE", LEGACY(Y))).status).toBe(204);
    expect((await setOf(Y)).map((r) => r.d)).toEqual([lib.C]);
  });
});
