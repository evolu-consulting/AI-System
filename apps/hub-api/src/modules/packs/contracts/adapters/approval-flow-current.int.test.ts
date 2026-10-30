// CR-105 L4 · `GET /pack/contracts/approval-flow` CHỈ ĐỌC (route thật + pool hub_api + Group thật ở `admin.groups` + cổng engine thật
// `resolveSlot`): tenant có gán ⇒ quy trình được gán (`is_default=false`), tenant chưa gán ⇒ mặc định của khe (`is_default=true`);
// phòng ban theo TÊN của tenant (mã Group ⇒ tên); `PUT /approval-flow` không còn ⇒ 404. Seed def thư viện + release + gán trực tiếp.
import { afterAll, beforeAll, expect, it } from "bun:test";
import { createDb, type Db as PackDb } from "@ai/db";
import { enablePack, groups, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import { packRunsPortForTest } from "../../../../test-support/pack-runs-port";
import { packGroups } from "../../kit/adapters/pack-groups";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import type { PackToolCatalog } from "../../kit/application/pack-tools.ports";
import { listDifyWorkflows, readCurrentFlow } from "../application/approval-flow.usecase";
import { APPROVAL_SLOT, compileSlotStages } from "../domain/approval-slot.rules";
import { approvalFlowRoutes } from "./approval-flow.routes";

let o: Sql;
let packDb: PackDb;
let hubDb: Db;
let A = "";
let B = "";
let own = "";
const F = { read: "f-r", write: "f-w", admin: "f-a" };
const defs = { dflt: "", special: "" };

const review = (key: string, name: string, dept: string, when: unknown = null) => ({
  kind: "review",
  key,
  name,
  department_group_id: null,
  department_group_key: dept,
  head_only: false,
  due_h: 72,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when,
});
const BODY = {
  dflt: { steps: [review("kt", "Kế toán duyệt", "ke-toan")] },
  special: {
    steps: [
      review("kt", "Kế toán duyệt", "ke-toan"),
      review("gd", "Giám đốc duyệt", "giam-doc", {
        op: "and",
        conds: [{ field: "total_value", op: "ge", value: 100_000_000 }],
      }),
    ],
  },
};

async function libDef(key: string, name: string, body: unknown): Promise<string> {
  const stages = JSON.stringify(compileSlotStages(body));
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body, published_version)
    values (null, ${key}, ${name}, ${stages}::text::jsonb, ${APPROVAL_SLOT}, ${JSON.stringify(body)}::text::jsonb, 1)
    returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, ${name}, ${stages}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  return id;
}

function app(tenant: string, user: string) {
  const view: PackAccessView = {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
      ],
      entitled: new Set(Object.values(F).map((f) => `${tenant}:${f}`)),
      grantGroups: new Map(Object.values(F).map((f) => [`${tenant}:${f}`, ["g-own"]])),
    }),
    user: async () => ({ tenantId: tenant, groupIds: new Set(["g-own"]) }),
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
    c.set("user", { userId: user, tenantId: tenant, role: "member" } as never);
    await next();
  });
  h.route(
    "/",
    approvalFlowRoutes(view, {
      read: readCurrentFlow(d),
      difyWorkflows: listDifyWorkflows({}),
    }),
  );
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 881)) as [string, string];
  [own] = (await users(o, A, 1, { from: 881 })) as [string];
  await enablePack(o, [A, B], "contracts");
  for (const [t, n] of [
    [A, "A"],
    [B, "B"],
  ] as const) {
    await groups(o, t, ["ke-toan", "giam-doc"]);
    await o`update admin.groups set name = jsonb_build_object('vi', 'Kế toán ' || ${n}) where tenant_id = ${t} and key = 'ke-toan'`;
    await o`update admin.groups set name = jsonb_build_object('vi', 'Giám đốc ' || ${n}) where tenant_id = ${t} and key = 'giam-doc'`;
  }
  defs.dflt = await libDef("pl-cur-default", "Quy trình HĐ mặc định", BODY.dflt);
  defs.special = await libDef("pl-cur-special", "Quy trình riêng", BODY.special);
  await o`insert into hub.process_slots (slot, default_def_id) values (${APPROVAL_SLOT}, ${defs.dflt})`;
  await o`insert into hub.process_slot_assignments (tenant_id, slot, def_id)
    values (${A}, ${APPROVAL_SLOT}, ${defs.special})`;
  packDb = createDb(urls().hubApi, { max: 3 });
  hubDb = connectDb(urls().hubApi, 2);
}, 120_000);
afterAll(async () => {
  await packDb?.close();
  await o?.end({ timeout: 2 });
});

type Out = {
  def_id: string;
  name: string;
  rel_version: number;
  is_default: boolean;
  steps: { name: string; department_name: string | null; kind: string; when?: unknown }[];
};

it("GET chỉ đọc quy trình đang dùng, PUT không còn", async () => {
  const ra = await app(A, own).request("/approval-flow");
  const a = (await ra.json()) as Out;
  expect({
    status: ra.status,
    def_id: a.def_id,
    name: a.name,
    rel: a.rel_version,
    is_default: a.is_default,
    steps: a.steps.map((s) => [s.name, s.department_name, s.kind]),
    when: a.steps[1]?.when,
  }).toEqual({
    status: 200,
    def_id: defs.special,
    name: "Quy trình riêng",
    rel: 1,
    is_default: false,
    steps: [
      ["Kế toán duyệt", "Kế toán A", "review"],
      ["Giám đốc duyệt", "Giám đốc A", "review"],
    ],
    when: { op: "and", conds: [{ field: "total_value", op: "ge", value: 100_000_000 }] },
  });
  // tenant chưa gán ⇒ mặc định của khe, tên phòng ban theo tenant của mình
  const rb = await app(B, own).request("/approval-flow");
  const b = (await rb.json()) as Out;
  expect({
    status: rb.status,
    def_id: b.def_id,
    is_default: b.is_default,
    dept: b.steps.map((s) => s.department_name),
  }).toEqual({
    status: 200,
    def_id: defs.dflt,
    is_default: true,
    dept: ["Kế toán B"],
  });
  // PUT không còn route
  const put = await app(A, own).request("/approval-flow", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, steps: [] }),
  });
  expect(put.status).toBe(404);
});
