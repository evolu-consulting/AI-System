// cr118-routing-deleted · review (Thấp): def trong tập gán đã xoá mềm / chưa xuất bản. Danh sách + sơ đồ bỏ def đã xoá (404),
// tenant_admin không bao giờ thấy nháp của platform (chỉ bản xuất bản; platform_admin xem nháp), luật trỏ def không chạy được
// mang `unavailable` (UI hiện lý do), PUT chọn def đó ⇒ 422 `ROUTING_PROCESS_UNAVAILABLE`, launch ⇒ `FLOW_ROUTE_UNAVAILABLE`.
// Hono thật + DB thật (`hub_api`), user giả qua header.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts";
import { groups, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { approvalEngineTools } from "../../packs/contracts/adapters/approval-engine.tools";
import type { ApprovalEnginePort } from "../../packs/contracts/application/approval-engine.ports";
import { slotFlowOf } from "../../packs/contracts/application/approval-engine-slot";
import { approvalSlotSpec } from "../../packs/contracts/approval.mount";
import { FLOW_ROUTE_UNAVAILABLE } from "../../packs/contracts/domain/approval-engine.rules";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/domain/approval-slot-default.rules";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { libraryRoutes } from "./library.routes";
import { resolveSlot } from "./slot-resolve.repo";
import { routeSlot } from "./slot-route.repo";

const SLOT = "contracts.approval";
const X = tenantId(1201);
const DFLT = APPROVAL_DEFAULT_DEF.id;
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1200), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1201), tenantId: X, role: "tenant_admin" },
};
const STARTER = userId(1202);
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
const lib = { L: "", D: "", U: "" };
let dept = "";

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const R = `/tenants/${X}/process-routing/${SLOT}`;

/** Bản sao def mặc định; `published` false ⇒ chỉ nháp (không release). */
async function libCopy(key: string, published: boolean): Promise<string> {
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    select null, ${key}, ${`QT ${key}`}, description, input_hint, run_group_ids, stages, token_budget, enabled, sources,
      inputs, slot, slot_body, ${published ? 1 : null}::int from hub.process_defs where id = ${DFLT}
    returning id::text as id`;
  const id = r?.id as string;
  if (published)
    await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
      select ${id}, 1, ${`QT ${key}`}, stages, slot_body from hub.process_def_releases
      where def_id = ${DFLT} order by rel_version desc limit 1`;
  return id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1201', 'Công ty X')`;
  await users(o, X, 3, { from: 1200 });
  await groups(o, X, ["contracts-editor", "contracts-owner"]);
  dept = (await groups(o, X, ["kinh-doanh"])).get("kinh-doanh") as string;
  await o`insert into admin.departments (tenant_id, group_id) values (${X}, ${dept})`;
  await members(o, X, dept, [STARTER]);
  lib.L = await libCopy("rd-l", true);
  lib.D = await libCopy("rd-d", true);
  lib.U = await libCopy("rd-u", false);
  await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot)
    values (${X}, ${lib.L}, ${SLOT}), (${X}, ${lib.D}, ${SLOT}), (${X}, ${lib.U}, ${SLOT})`;
  await o`insert into hub.process_routings (tenant_id, slot) values (${X}, ${SLOT})`;
  const cond = JSON.stringify({ departmentIds: [dept] });
  await o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default) values
    (${X}, ${SLOT}, 0, ${cond}::text::jsonb, ${lib.D}, false),
    (${X}, ${SLOT}, 1, ${cond}::text::jsonb, ${lib.U}, false),
    (${X}, ${SLOT}, 2, '{}'::jsonb, ${lib.L}, true)`;
  await o`update hub.process_defs set deleted_at = now() where id = ${lib.D}`;
  slotRegistry.register(approvalSlotSpec);
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

describe("cr118-routing-deleted · def đã xoá / chưa xuất bản trong tập gán", () => {
  it("danh sách bỏ def đã xoá, luật mang lý do unavailable", async () => {
    const r = await call("A", "GET", R);
    expect(r.status).toBe(200);
    expect({
      processes: (r.json.processes as Json[])
        .map((p) => [p.def_id, p.rel_version])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      rules: (r.json.rules as Json[]).map((x) => [x.def_id, x.unavailable ?? null]),
    }).toEqual({
      processes: [
        [lib.L, 1],
        [lib.U, null],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      rules: [
        [lib.D, "deleted"],
        [lib.U, "unpublished"],
        [lib.L, null],
      ],
    });
  });

  it("sơ đồ: def đã xoá ⇒ 404, nháp chỉ platform_admin xem", async () => {
    const def = async (who: string, id: string) => {
      const r = await call(who, "GET", `${R}/processes/${id}`);
      return r.status === 200 ? [r.status, r.json.rel_version] : [r.status];
    };
    expect({
      aDeleted: await def("A", lib.D),
      aDraft: await def("A", lib.U),
      aLive: await def("A", lib.L),
      pDeleted: await def("P", lib.D),
      pDraft: await def("P", lib.U),
    }).toEqual({
      aDeleted: [404],
      aDraft: [404],
      aLive: [200, 1],
      pDeleted: [404],
      pDraft: [200, null],
    });
  });

  it("launch khớp luật có def đã xoá ⇒ FLOW_ROUTE_UNAVAILABLE", async () => {
    const routed = await routeSlot(db, X, SLOT, STARTER);
    expect(routed && "blocked" in routed ? routed.blocked : routed).toBe("route_unavailable");
    const port = {
      resolveSlot: (t: string, s: string) => resolveSlot(db, t, s),
      routeSlot: (t: string, s: string, u: string) => routeSlot(db, t, s, u),
      sourceRefOf: () => "0123456789abcdef",
    } as unknown as ApprovalEnginePort;
    const groupsOf = { idsOf: async () => new Map<string, string>() };
    expect(await slotFlowOf({ bridge: { port }, groups: groupsOf }, X, STARTER)).toEqual({
      invalid: FLOW_ROUTE_UNAVAILABLE,
    });
  });

  it("PUT chọn def đã xoá / chưa xuất bản ⇒ 422 ROUTING_PROCESS_UNAVAILABLE", async () => {
    const put = (d: string) =>
      call("A", "PUT", R, {
        version: 1,
        rules: [{ condition: {}, def_id: d, is_default: true }],
      });
    const del = await put(lib.D);
    const draft = await put(lib.U);
    expect({
      del: [del.status, del.json.error?.code, del.json.error?.details?.reason],
      draft: [draft.status, draft.json.error?.code, draft.json.error?.details?.reason],
    }).toEqual({
      del: [422, "ROUTING_PROCESS_UNAVAILABLE", "deleted"],
      draft: [422, "ROUTING_PROCESS_UNAVAILABLE", "unpublished"],
    });
    const ok = await put(lib.L);
    expect({ s: ok.status, v: ok.json.version, n: ok.json.rules.length }).toEqual({
      s: 200,
      v: 2,
      n: 1,
    });
  });
});
