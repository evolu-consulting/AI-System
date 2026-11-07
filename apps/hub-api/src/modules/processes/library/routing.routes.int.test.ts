// CR-118 §11.2 · làn đầy đủ · viết TRƯỚC code phần quyền/tenant: route tập quy trình đã gán + luật chọn quy trình qua Hono thật
// (`libraryRoutes`) trên DB thật (`hub_api`), user giả qua header. Kiểm trạng thái DB thật (hàng luật, tập gán, audit, version cấu
// hình), không chỉ mã HTTP. Khe `contracts.approval` thật; def thư viện = bản sao def mặc định seed 0069 (đã xuất bản v1).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
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
import { communitySlotSpecs } from "../../packs/community/public";
import { communityFlowPorts } from "../../packs/community-flow.mount";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/public";
import {
  approvalEngineTools,
  approvalSlotSpec,
  intakeSlotSpec,
} from "../../packs/contracts/testing";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { libraryRoutes } from "./library.routes";

const SLOT = "contracts.approval";
const X = tenantId(1181);
const Y = tenantId(1182);
const DFLT = APPROVAL_DEFAULT_DEF.id;
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1180), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1181), tenantId: X, role: "tenant_admin" },
  M: { userId: userId(1182), tenantId: X, role: "member" },
  AY: { userId: userId(1183), tenantId: Y, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
type Res = { status: number; json: Json };

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
const lib = { A: "", B: "", C: "" };
let dx: Map<string, string>;
let dy: Map<string, string>;

async function call(who: string, method: string, path: string, body?: unknown): Promise<Res> {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : {} };
}
const R = (t: string) => `/tenants/${t}/process-routing/${SLOT}`;
const ver = async () => Number((await call("A", "GET", R(X))).json.version);
const defaultRule = async (t: string) => [
  ...(await o`select def_id::text as d, source as s from hub.process_routing_rules
    where tenant_id = ${t} and slot = ${SLOT} and is_default`),
];
const PROC = (t: string, d: string) => `${R(t)}/processes/${d}`;

/** Bản sao def mặc định (đã xuất bản v1, đủ nút hệ thống) — chỉ đổi id/key/tên. */
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
async function depts(t: string, keys: string[]): Promise<Map<string, string>> {
  const g = await groups(o, t, keys);
  for (const k of keys)
    await o`insert into admin.departments (tenant_id, group_id) values (${t}, ${g.get(k) as string})`;
  return g;
}
const hubVersion = async () =>
  Number((await o`select hub_config_version as v from hub.config_meta where id = 1`)[0]?.v);
const rulesInDb = async (t: string) => [
  ...(await o`select priority, def_id::text as d, is_default as f, condition as c from hub.process_routing_rules
    where tenant_id = ${t} order by priority`),
];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1181', 'Công ty X'), (${Y}, 't1182', 'Công ty Y')`;
  await users(o, X, 3, { from: 1180 });
  await users(o, Y, 1, { from: 1183 });
  await groups(o, X, ["contracts-editor", "contracts-owner"]);
  await groups(o, Y, ["contracts-editor", "contracts-owner"]);
  dx = await depts(X, ["kinh-doanh", "van-hanh"]);
  dy = await depts(Y, ["phong-y"]);
  lib.A = await libCopy("rt-a", "QT A");
  lib.B = await libCopy("rt-b", "QT B");
  lib.C = await libCopy("rt-c", "QT C");
  slotRegistry.register(approvalSlotSpec);
  slotRegistry.register(intakeSlotSpec);
  for (const s of communitySlotSpecs()) slotRegistry.register(s);
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
    key: t.name,
    name: t.name,
    description: t.description,
    sideEffect: false,
    action: t.action,
    params: t.params,
  }));
  const packTools = {
    has: (k: string) => tools.some((t) => t.key === k),
    info: (k: string) => tools.find((t) => t.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((t) => !keys || keys.includes(t.key)),
  } as unknown as PackToolCatalog;
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
  app.route("/", libraryRoutes({ db, packTools, start: {} } as unknown as ProcessDeps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-118 §11.2 · API luật chọn quy trình", () => {
  it("platform_admin gán và bỏ gán quy trình", async () => {
    for (const who of ["A", "M"]) expect((await call(who, "PUT", PROC(X, lib.A))).status).toBe(403);
    expect((await call("P", "PUT", PROC(X, lib.A))).status).toBe(200);
    // CR-121 F-1 · gán = luật mặc định của khe đổi theo (source admin), gán quy trình khác ⇒ mặc định đổi sang đó.
    expect(await defaultRule(X)).toEqual([{ d: lib.A, s: "admin" }]);
    const r = await call("P", "PUT", PROC(X, lib.B));
    expect(r.json.processes.map((p: Json) => p.def_id).sort()).toEqual([lib.A, lib.B].sort());
    expect(await defaultRule(X)).toEqual([{ d: lib.B, s: "admin" }]);
    const v0 = await hubVersion();
    expect((await call("P", "PUT", PROC(X, lib.B))).status).toBe(200); // đã là mặc định do admin đặt ⇒ không bump
    expect(await hubVersion()).toBe(v0);
    // luật dùng A ⇒ bỏ gán A bị chặn kèm danh sách luật
    const put = await call("P", "PUT", R(X), {
      version: 2,
      rules: [{ condition: { departmentIds: [dx.get("kinh-doanh")] }, def_id: lib.A }],
    });
    expect({ s: put.status, v: put.json.version }).toEqual({ s: 200, v: 3 });
    const del = await call("P", "DELETE", PROC(X, lib.A));
    expect({
      s: del.status,
      e: del.json.error?.code,
      rules: del.json.error?.details?.rules,
    }).toEqual({
      s: 409,
      e: "ROUTING_PROCESS_IN_USE",
      rules: [{ id: put.json.rules[0].id, priority: 0 }],
    });
    expect(del.json.error?.message).toContain("sửa hoặc xoá các luật đó rồi bỏ gán");
    expect((await call("P", "PUT", PROC(X, lib.C))).status).toBe(200);
    // C đang là luật mặc định ⇒ bỏ gán bị chặn; gán B (đổi mặc định về B) rồi mới bỏ C được.
    const inDefault = await call("P", "DELETE", PROC(X, lib.C));
    expect({ s: inDefault.status, e: inDefault.json.error?.code }).toEqual({
      s: 409,
      e: "ROUTING_PROCESS_IN_USE",
    });
    // Thông điệp nói cách sửa (Luật GỐC 3): đang là mặc định ⇒ gán quy trình khác làm mặc định trước.
    expect(inDefault.json.error?.message).toContain(
      "gán quy trình khác làm mặc định trước rồi bỏ gán",
    );
    expect((await call("P", "PUT", PROC(X, lib.B))).status).toBe(200);
    expect((await call("P", "DELETE", PROC(X, lib.C))).status).toBe(204);
    const left =
      await o`select def_id::text as d from hub.process_tenant_defs where tenant_id = ${X} order by 1`;
    expect(left.map((x) => x.d)).toEqual([lib.A, lib.B].sort());
    const audits = await o`select action, count(*)::int as n from hub.audit_log
      where tenant_id = ${X} and action in ('assign_process', 'unassign_process') group by action order by action`;
    expect([...audits]).toEqual([
      { action: "assign_process", n: 4 },
      { action: "unassign_process", n: 1 },
    ]);
  });

  it("tenant admin lưu luật", async () => {
    const g = await call("A", "GET", R(X));
    const v1 = Number(g.json.version);
    expect({ s: g.status, v: v1, n: g.json.processes.length }).toEqual({ s: 200, v: 5, n: 2 });
    const v0 = await hubVersion();
    const r = await call("A", "PUT", R(X), {
      version: v1,
      rules: [
        { condition: { departmentIds: [dx.get("van-hanh")] }, def_id: lib.B },
        { condition: { departmentIds: [dx.get("kinh-doanh")] }, def_id: lib.A },
        { condition: { departmentIds: [dx.get("van-hanh")] }, def_id: lib.A, is_default: true },
      ],
    });
    expect({ s: r.status, v: r.json.version }).toEqual({ s: 200, v: v1 + 1 });
    expect(await rulesInDb(X)).toEqual([
      { priority: 0, d: lib.B, f: false, c: { departmentIds: [dx.get("van-hanh")] } },
      { priority: 1, d: lib.A, f: false, c: { departmentIds: [dx.get("kinh-doanh")] } },
      { priority: 2, d: lib.A, f: true, c: {} },
    ]);
    expect(await hubVersion()).toBe(v0 + 1);
    const [a] =
      await o`select actor_role, before->>'version' as b, after->>'version' as af from hub.audit_log
      where tenant_id = ${X} and action = 'set_routing' order by at desc limit 1`;
    expect(a).toEqual({ actor_role: "tenant_admin", b: String(v1), af: String(v1 + 1) });
  });

  it("quy trình chưa gán ⇒ 422", async () => {
    const v = await ver();
    const r = await call("A", "PUT", R(X), {
      version: v,
      rules: [{ condition: { departmentIds: [dx.get("van-hanh")] }, def_id: lib.C }],
    });
    expect({ s: r.status, e: r.json.error?.code }).toEqual({
      s: 422,
      e: "ROUTING_PROCESS_NOT_ASSIGNED",
    });
    const many = Array.from({ length: 51 }, () => ({
      condition: { departmentIds: [dx.get("van-hanh")] },
      def_id: lib.A,
    }));
    // > 50 luật ⇒ chặn ở contract (zod `max`) ⇒ 400 VALIDATION_ERROR, không ghi gì.
    expect((await call("A", "PUT", R(X), { version: v, rules: many })).status).toBe(400);
    expect(await ver()).toBe(v);
  });

  it("phòng ban tenant khác ⇒ 422", async () => {
    const r = await call("A", "PUT", R(X), {
      version: await ver(),
      rules: [{ condition: { departmentIds: [dy.get("phong-y")] }, def_id: lib.A }],
    });
    expect({ s: r.status, e: r.json.error?.code, d: r.json.error?.details }).toEqual({
      s: 422,
      e: "ROUTING_DEPARTMENT_INVALID",
      d: { department_ids: [dy.get("phong-y")] },
    });
    expect((await rulesInDb(X)).length).toBe(3);
  });

  it("tenant admin tenant khác ⇒ 404, member ⇒ 403", async () => {
    const body = { version: 2, rules: [] };
    expect((await call("AY", "GET", R(X))).status).toBe(404);
    expect((await call("AY", "PUT", R(X), body)).status).toBe(404);
    expect((await call("M", "GET", R(X))).status).toBe(403);
    expect((await call("M", "PUT", R(X), body)).status).toBe(403);
    expect((await rulesInDb(X)).length).toBe(3);
  });

  it("ghi đồng thời ⇒ 409", async () => {
    const v = await ver();
    const body = (d: string) => ({
      version: v,
      rules: [{ condition: { departmentIds: [dx.get("kinh-doanh")] }, def_id: d }],
    });
    const [a, b] = await Promise.all([
      call("A", "PUT", R(X), body(lib.A)),
      call("P", "PUT", R(X), body(lib.B)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const lost = a.status === 409 ? a : b;
    expect(lost.json.error).toEqual(
      expect.objectContaining({ code: "VERSION_CONFLICT", details: { current_version: v + 1 } }),
    );
    expect((await rulesInDb(X)).length).toBe(1);
  });

  it("RLS chặn đọc chéo tenant", async () => {
    const asY = { kind: "user" as const, tenantId: Y, userId: WHO.AY?.userId as string };
    const seen = await withHubScope(db, asY, async (tx) => {
      const n = async (t: string) =>
        Number(
          (
            await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from ${sql.raw(t)} where tenant_id = ${X}`,
            )
          )[0]?.n,
        );
      return {
        rules: await n("hub.process_routing_rules"),
        heads: await n("hub.process_routings"),
        assigned: await n("hub.process_tenant_defs"),
      };
    });
    expect(seen).toEqual({ rules: 0, heads: 0, assigned: 0 });
    const asX = { kind: "user" as const, tenantId: X, userId: WHO.A?.userId as string };
    const own = await withHubScope(db, asX, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.process_routing_rules`),
    );
    expect(own[0]?.n).toBe(1);
    // Ghi chéo tenant ở scope user ⇒ RLS từ chối; tenant ghi tập gán ⇒ từ chối (chỉ system).
    const err = (p: Promise<unknown>) =>
      p
        .then(() => "ok")
        .catch((e) =>
          String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code),
        );
    expect(
      await err(
        withHubScope(db, asY, (tx) =>
          tx.execute(
            sql`insert into hub.process_routings (tenant_id, slot) values (${X}, ${SLOT})`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await err(
        withHubScope(db, asX, (tx) =>
          tx.execute(
            sql`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${X}, ${lib.C}, ${SLOT})`,
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("xem sơ đồ quy trình đã gán: quyền + tập gán", async () => {
    // Tập gán X lúc này: A, B (C đã bỏ gán ở ca đầu). Y chưa gán gì.
    const ok = await call("A", "GET", PROC(X, lib.A));
    const [rel] = await o`select stages, slot_body from hub.process_def_releases
      where def_id = ${lib.A} and rel_version = 1`;
    expect({ s: ok.status, j: ok.json }).toEqual({
      s: 200,
      j: {
        def_id: lib.A,
        slot: SLOT,
        name: "QT A",
        rel_version: 1,
        stages: rel?.stages,
        slot_body: rel?.slot_body,
      },
    });
    expect(ok.json.stages.length).toBeGreaterThan(0);
    expect((await call("P", "GET", PROC(X, lib.B))).status).toBe(200);
    expect((await call("AY", "GET", PROC(X, lib.A))).status).toBe(404); // tenant khác
    expect((await call("A", "GET", PROC(X, lib.C))).status).toBe(404); // chưa gán
    expect((await call("P", "GET", PROC(Y, lib.A))).status).toBe(404); // chưa gán cho Y
    expect((await call("A", "GET", PROC(X, DFLT))).status).toBe(404);
    expect((await call("M", "GET", PROC(X, lib.A))).status).toBe(403);
    // Ghi vẫn chỉ platform_admin.
    expect((await call("A", "DELETE", PROC(X, lib.B))).status).toBe(403);
  });

  it("cr118-route-kind · luật theo loại HĐ: lưu, loại ngoài enum ⇒ 400, không điều kiện ⇒ 422", async () => {
    const version = (await call("A", "GET", R(X))).json.version as number;
    const kd = dx.get("kinh-doanh") as string;
    const r = await call("A", "PUT", R(X), {
      version,
      rules: [
        { condition: { departmentIds: [kd], contractKinds: ["buy", "buy"] }, def_id: lib.A },
        { condition: { contractKinds: ["sell"], departmentIds: [] }, def_id: lib.B },
        { condition: { departmentIds: [kd] }, def_id: lib.B },
      ],
    });
    expect({ s: r.status, c: r.json.rules?.map((x: Json) => x.condition) }).toEqual({
      s: 200,
      c: [
        { departmentIds: [kd], contractKinds: ["buy"] },
        { contractKinds: ["sell"] },
        { departmentIds: [kd] },
      ],
    });
    const bad = await call("A", "PUT", R(X), {
      version: version + 1,
      rules: [{ condition: { contractKinds: ["lease"] }, def_id: lib.A }],
    });
    expect(bad.status).toBe(400);
    const empty = await call("A", "PUT", R(X), {
      version: version + 1,
      rules: [{ condition: { departmentIds: [], contractKinds: [] }, def_id: lib.A }],
    });
    expect({ s: empty.status, d: empty.json.error?.details }).toEqual({
      s: 422,
      d: { reason: "no_condition", index: 0 },
    });
    expect((await rulesInDb(X)).length).toBe(3);
  });

  it("cr120-handson-fixes · GET routing của MỌI khe manifest khai báo ⇒ 200; khe opt-in tắt ⇒ active=false", async () => {
    const slots = Object.values(APP_MANIFESTS).flatMap((m) => m.slots.map((s) => s.key));
    expect(slots).toContain("contracts.intake");
    for (const slot of slots) {
      const r = await call("P", "GET", `/tenants/${X}/process-routing/${slot}`);
      expect({ slot, status: r.status }).toEqual({ slot, status: 200 });
      expect({ slot, active: r.json.active }).toEqual({
        slot,
        active: !slot.startsWith("community."),
      });
    }
  });

  it("CR-121 F-1 · khe opt-in (duyệt bài Community): chưa gán ⇒ tắt · gán ⇒ bật và chạy đúng quy trình đó · bỏ gán ⇒ tắt lại", async () => {
    const MOD = "community.post-moderation";
    const modR = `/tenants/${Y}/process-routing/${MOD}`;
    const on = () => communityFlowPorts(db, undefined).moderationOn?.(Y) as Promise<boolean>;
    const [seed] =
      await o`select default_def_id::text as id from hub.process_slots where slot = ${MOD}`;
    const [d] = await o`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
        run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
      select null, 'rt-mod', 'QT duyệt bài', description, input_hint, run_group_ids, stages, token_budget, enabled,
        sources, inputs, slot, slot_body, 1 from hub.process_defs where id = ${seed?.id} returning id::text as id`;
    const id = d?.id as string;
    await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
      select id, 1, name, stages, slot_body from hub.process_defs where id = ${id}`;

    const g0 = await call("P", "GET", modR);
    expect({ s: g0.status, active: g0.json.active, procs: g0.json.processes.length }).toEqual({
      s: 200,
      active: false,
      procs: 0,
    });
    expect(await on()).toBe(false);

    const asg = await call("P", "PUT", `${modR}/processes/${id}`);
    expect({ s: asg.status, active: asg.json.active, cur: asg.json.current_def_id }).toEqual({
      s: 200,
      active: true,
      cur: id,
    });
    expect([
      ...(await o`select def_id::text as d, source as s, is_default as f from hub.process_routing_rules
      where tenant_id = ${Y} and slot = ${MOD}`),
    ]).toEqual([{ d: id, s: "admin", f: true }]);
    expect(await on()).toBe(true);

    // Bỏ gán quy trình mặc định duy nhất của khe opt-in = tắt khe (không bị 409 chặn, không còn luật mồ côi).
    expect((await call("P", "DELETE", `${modR}/processes/${id}`)).status).toBe(204);
    const g1 = await call("P", "GET", modR);
    expect({
      active: g1.json.active,
      rules: g1.json.rules.length,
      procs: g1.json.processes.length,
    }).toEqual({
      active: false,
      rules: 0,
      procs: 0,
    });
    expect(await on()).toBe(false);
  });
});
