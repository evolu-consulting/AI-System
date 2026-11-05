// hub-routing-backfill · viết TRƯỚC code: tenant gán theo đường cũ (`process_slot_assignments`, CR-105/CR-113) phải hiện trong
// tập quy trình CR-118 (`process_tenant_defs`). (1) hub 0089 backfill: chạy lại vô hại, tenant khác không đổi, RLS theo tenant.
// (2) PUT/DELETE `/tenants/:tid/process-slots/:slot` đồng bộ tập gán (bỏ gán giữ lại khi luật còn dùng). (3) GET routing trả
// `current_def_id` = quy trình chạy khi không có luật (gán cũ, không có ⇒ mặc định khe). Kiểm trạng thái DB thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { Role } from "@ai/contracts";
import { withHubScope } from "@ai/db/hub-scope";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { approvalSlotSpec } from "../../packs/contracts/approval.mount";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/domain/approval-slot-default.rules";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { ProcessDeps } from "../core/ports";
import { libraryRoutes } from "./library.routes";

const SLOT = "contracts.approval";
const X = tenantId(1191);
const Y = tenantId(1192);
const Z = tenantId(1193);
const DFLT = APPROVAL_DEFAULT_DEF.id;
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

const MIGRATION = readFileSync(
  new globalThis.URL(
    "../../../../../../packages/db/migrations-hub/0089_routing_backfill.sql",
    import.meta.url,
  ),
  "utf8",
);
async function runBackfill() {
  for (const stmt of MIGRATION.split("--> statement-breakpoint"))
    if (stmt.trim()) await o.unsafe(stmt);
}
const setOf = async (t: string) => [
  ...(await o`select def_id::text as d, slot, assigned_by from hub.process_tenant_defs
    where tenant_id = ${t} order by def_id`),
];
const ruleCount = async () =>
  Number((await o`select count(*)::int as n from hub.process_routing_rules`)[0]?.n);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name)
    values (${X}, 't1191', 'Cty X'), (${Y}, 't1192', 'Cty Y'), (${Z}, 't1193', 'Cty Z')`;
  await users(o, X, 1, { from: 1190 });
  await users(o, Z, 1, { from: 1193 });
  for (const t of [X, Y, Z]) await groups(o, t, ["contracts-editor", "contracts-owner"]);
  lib.A = await libCopy("bf-a", "QT A");
  lib.B = await libCopy("bf-b", "QT B");
  lib.C = await libCopy("bf-c", "QT C");
  slotRegistry.register(approvalSlotSpec);
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

describe("hub-routing-backfill · hub 0089 backfill tập gán từ gán cũ", () => {
  it("tenant gán cũ vào tập (assigned_by system), chạy lại vô hại, tenant khác giữ nguyên, RLS theo tenant", async () => {
    // X: chỉ gán cũ (như Demo trước CR-118). Y: gán cũ B + đã có C trong tập.
    await o`insert into hub.process_slot_assignments (tenant_id, slot, def_id) values (${X}, ${SLOT}, ${lib.A}),
      (${Y}, ${SLOT}, ${lib.B})`;
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot, assigned_by)
      values (${Y}, ${lib.C}, ${SLOT}, ${userId(1190)})`;
    const rules0 = await ruleCount();
    await runBackfill();
    expect(await setOf(X)).toEqual([{ d: lib.A, slot: SLOT, assigned_by: null }]);
    const y = await setOf(Y);
    expect(y.map((r) => r.d).sort()).toEqual([lib.B, lib.C].sort());
    expect(y.find((r) => r.d === lib.C)?.assigned_by).toBe(userId(1190)); // hàng có sẵn không bị đè
    expect(await setOf(Z)).toEqual([]);
    expect(await ruleCount()).toBe(rules0); // không tạo luật
    const n = async () =>
      Number((await o`select count(*)::int as n from hub.process_tenant_defs`)[0]?.n);
    const before = await n();
    await runBackfill();
    expect(await n()).toBe(before);
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
    // luật mặc định dùng C ⇒ bỏ gán cũ vẫn giữ C trong tập (FK luật), launch không luật ⇒ mặc định khe
    const put = await call("AZ", "PUT", ROUTING(Z), {
      version: 0,
      rules: [{ condition: {}, def_id: lib.C, is_default: true }],
    });
    expect(put.status).toBe(200);
    expect((await call("P", "DELETE", LEGACY(Z))).status).toBe(204);
    expect((await setOf(Z)).map((r) => r.d)).toEqual([lib.C]);
    g = await call("AZ", "GET", ROUTING(Z));
    expect(g.json.current_def_id).toBe(DFLT);
    expect(
      (await o`select 1 from hub.process_slot_assignments where tenant_id = ${Z}`).length,
    ).toBe(0);
  });

  it("DELETE gán cũ không có luật ⇒ bỏ khỏi tập", async () => {
    expect((await call("P", "PUT", LEGACY(Y), { def_id: lib.A })).status).toBe(200);
    expect((await setOf(Y)).map((r) => r.d).sort()).toEqual([lib.A, lib.C].sort()); // B (cũ, không luật) ra
    expect((await call("P", "DELETE", LEGACY(Y))).status).toBe(204);
    expect((await setOf(Y)).map((r) => r.d)).toEqual([lib.C]);
  });
});
