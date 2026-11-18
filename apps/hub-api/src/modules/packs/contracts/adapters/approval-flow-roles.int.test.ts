// CR-182 · BR-G1/G3 · `PUT /pack/contracts/approval-flow/roles` (route thật + pool hub_api + Group/người thật + cổng engine thật):
// người thường (kể cả có quyền ghi gói) ⇒ 403 · quản trị gói Sổ Hợp Tác (KHÔNG phải tenant admin) ⇒ 200 · tenant admin ⇒ 200 ·
// vai không có trong quy trình ⇒ 422 · cả nhóm lẫn người ⇒ 400 · `GET` thấy `graph[].role/assigned` (nhóm kèm thành viên / người / chưa giao).
import { afterAll, beforeAll, expect, it } from "bun:test";
import { createDb, type Db as PackDb } from "@ai/db";
import { enablePack, groups, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import { packRunsPortForTest } from "../../../../test-support/pack-runs-port";
import { packGroups } from "../../kit/adapters/pack-groups";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import type { PackToolCatalog } from "../../kit/application/pack-tools.ports";
import { listDifyWorkflows, readCurrentFlows } from "../application/approval-flow.usecase";
import { assignFlowRole, companyAdminCheck } from "../application/approval-flow-roles.usecase";
import { approvalFlowRoutes } from "./approval-flow.routes";

let o: Sql;
let packDb: PackDb;
let hubDb: Db;
let A = "";
let U: { admin: string; pack: string; mem: string } = { admin: "", pack: "", mem: "" };
let gKt = "";
let flowId = "";
const F = { read: "f-r", write: "f-w", admin: "f-a" };
const ROLE = { key: "nguoi-duyet-cap-1", label: "Người duyệt cấp 1" };
const STAGES = [
  {
    key: "tp",
    name: "Duyệt",
    step: 0,
    executor: { kind: "approve", reject_step: 2, return_step: 2 },
    after: { kind: "review", group_id: null, role: ROLE },
  },
  {
    key: "ky",
    name: "Ký hợp đồng",
    step: 1,
    node: "contracts.esign",
    executor: {
      kind: "tool",
      tool_key: "contracts-esign-send",
      args: { signer_role: { from: "const", value: "nguoi-ky" } },
    },
  },
];

function app(user: string, role: string) {
  const view: PackAccessView = {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
      ],
      entitled: new Set(Object.values(F).map((f) => `${A}:${f}`)),
      grantGroups: new Map([
        [`${A}:${F.read}`, ["g-mem"]],
        [`${A}:${F.write}`, ["g-mem"]],
        [`${A}:${F.admin}`, ["g-adm"]],
      ]),
    }),
    user: async (id: string) => ({
      tenantId: A,
      groupIds: new Set(id === U.pack ? ["g-mem", "g-adm"] : ["g-mem"]),
    }),
  };
  const catalog = {
    has: () => false,
    info: () => undefined,
    enabled: async () => true,
    available: async () => [],
  } as unknown as PackToolCatalog;
  const d = {
    groups: packGroups(packDb, view, "contracts"),
    engine: { port: packRunsPortForTest(hubDb, catalog) as never },
  };
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", { userId: user, tenantId: A, role } as never);
    await next();
  });
  h.route(
    "/",
    approvalFlowRoutes(view, {
      read: readCurrentFlows(d),
      difyWorkflows: listDifyWorkflows({}),
      assignRole: assignFlowRole(d),
      isAdmin: companyAdminCheck(view),
    }),
  );
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}
const put = (a: Hono<PackGuardVars>, body: unknown) =>
  a.request("/approval-flow/roles", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A] = (await tenants(o, 1, 1830)) as [string];
  const us = (await users(o, A, 3, { from: 1830 })) as [string, string, string];
  U = { admin: us[0], pack: us[1], mem: us[2] };
  await o`update admin.users set role = 'tenant_admin' where id = ${U.admin}`;
  await enablePack(o, [A], "contracts");
  const g = await groups(o, A, ["ke-toan"]);
  gKt = g.get("ke-toan") as string;
  await members(o, A, gKt, [us[2]]);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
    values (${A}, 'cr182-route', 'Duyệt + ký', ${JSON.stringify(STAGES)}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts')
    returning id::text as id`;
  flowId = r?.id as string;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${A}, ${flowId}, true, 0)`;
  packDb = createDb(urls().hubApi, { max: 3 });
  hubDb = connectDb(urls().hubApi, 2);
}, 120_000);
afterAll(async () => {
  await packDb?.close();
  await o?.end({ timeout: 2 });
});

it("người thường (có quyền ghi gói, không phải quản trị) PUT ⇒ 403 và không ghi gì", async () => {
  const res = await put(app(U.mem, "member"), {
    flow_id: flowId,
    role_key: ROLE.key,
    group_id: gKt,
  });
  expect(res.status).toBe(403);
  const [n] =
    await o`select count(*)::int as n from hub.process_role_assignments where tenant_id = ${A}`;
  expect(n?.n).toBe(0);
});

it("quản trị gói Sổ Hợp Tác (vai member, KHÔNG phải tenant admin) PUT ⇒ 200, nhóm kèm thành viên, audit role_assigned", async () => {
  const res = await put(app(U.pack, "member"), {
    flow_id: flowId,
    role_key: ROLE.key,
    group_id: gKt,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    assigned: { kind: string; id: string; members: { id: string }[] };
  };
  expect(body.assigned).toMatchObject({ kind: "group", id: gKt });
  expect(body.assigned.members.map((m) => m.id)).toEqual([U.mem]);
  const [a] =
    await o`select actor_id::text as actor from hub.audit_log where tenant_id = ${A} and action = 'role_assigned'`;
  expect(a?.actor).toBe(U.pack);
});

it("GET: bước Duyệt có role + assigned (nhóm); bước Ký chưa giao ⇒ assigned null (viền vàng)", async () => {
  const res = await app(U.mem, "member").request("/approval-flow");
  const { items } = (await res.json()) as {
    items: {
      graph: { key: string; role?: { key: string }; assigned?: { kind: string } | null }[];
    }[];
  };
  const g = items[0]?.graph ?? [];
  expect(g.find((x) => x.key === "tp")).toMatchObject({
    role: { key: ROLE.key },
    assigned: { kind: "group" },
  });
  expect(g.find((x) => x.key === "ky")).toMatchObject({
    role: { key: "nguoi-ky" },
    assigned: null,
  });
});

it("tenant admin giao MỘT NGƯỜI cho vai Ký ⇒ 200; vai lạ ⇒ 422; cả nhóm lẫn người ⇒ 400", async () => {
  const a = app(U.admin, "tenant_admin");
  const ok = await put(a, { flow_id: flowId, role_key: "nguoi-ky", user_id: U.mem });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { assigned: { kind: string } }).assigned.kind).toBe("user");
  expect((await put(a, { flow_id: flowId, role_key: "khong-co", group_id: gKt })).status).toBe(422);
  expect(
    (await put(a, { flow_id: flowId, role_key: ROLE.key, group_id: gKt, user_id: U.mem })).status,
  ).toBe(400);
});
