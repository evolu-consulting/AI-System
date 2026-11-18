// CR-125 · S2 · `GET /pack/contracts/approval-flow` CHỈ ĐỌC, nguồn MỘT: flow Bật của `hub.company_flows` cho `contract.submitted` (cùng dữ liệu
// tab Quy trình ở admin; route thật + pool hub_api + Group thật ở `admin.groups` + cổng engine thật `eventFlow`). Công ty có flow Bật ⇒ tên +
// bản + bước theo thứ tự + tên phòng ban của công ty (mã Thư viện ⇒ tên; id Group ⇒ tên); công ty khác chưa có flow ⇒ 404 (không đọc chéo,
// không còn "Quy trình mặc định" của khe); flow Tắt không tính; `PUT /approval-flow` không có ⇒ 404.
import { afterAll, beforeAll, expect, it } from "bun:test";
import { createDb, type Db as PackDb } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { enablePack, groups, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import { packRunsPortForTest } from "../../../../test-support/pack-runs-port";
import { EVENT_FLOW_SQL } from "../../../processes/library/event-flow.repo";
import { NEVER_TRIGGER } from "../../../processes/library/purchase-templates";
import type { ClaimedEvent } from "../../../processes/triggers/dispatcher.repo";
import { candidatesOf } from "../../../processes/triggers/dispatcher.repo";
import { packGroups } from "../../kit/adapters/pack-groups";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import type { PackToolCatalog } from "../../kit/application/pack-tools.ports";
import { listDifyWorkflows, readCurrentFlows } from "../application/approval-flow.usecase";
import { approvalFlowRoutes } from "./approval-flow.routes";

let o: Sql;
let packDb: PackDb;
let hubDb: Db;
let A = "";
let B = "";
let own = "";
let flowId = "";
const F = { read: "f-r", write: "f-w", admin: "f-a" };

const stage = (key: string, name: string, step: number, extra: Record<string, unknown>) => ({
  key,
  name,
  step,
  ...extra,
});
const approve = (key: string, name: string, step: number, groupKey: string) =>
  stage(key, name, step, {
    executor: { kind: "approve", reject_step: 5, return_step: 6 },
    after: { kind: "review", group_id: null, group_key: groupKey },
  });
const STAGES = [
  approve("tp", "Trưởng phòng duyệt", 0, "ke-toan"),
  approve("gd", "Giám đốc duyệt", 1, "giam-doc"),
  stage("ky", "Ký số", 2, {
    node: "contracts.esign",
    executor: { kind: "tool", tool_key: "contracts-esign-send" },
  }),
  stage("cho", "Chờ ký xong", 3, { executor: { kind: "wait_event", event: "esign.completed" } }),
  stage("end", "Kết thúc · Đã duyệt", 4, {
    executor: { kind: "set", values: [] },
    outcome: "approved",
  }),
];

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
    approvalFlowRoutes(view, { read: readCurrentFlows(d), difyWorkflows: listDifyWorkflows({}) }),
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
  [A, B] = (await tenants(o, 2, 882)) as [string, string];
  const us = (await users(o, A, 3, { from: 882 })) as [string, string, string];
  own = us[0];
  await enablePack(o, [A, B], "contracts");
  for (const [t, n] of [
    [A, "A"],
    [B, "B"],
  ] as const) {
    const g = await groups(o, t, ["ke-toan", "giam-doc"]);
    if (t === A) await members(o, A, g.get("ke-toan") as string, us);
    await o`update admin.groups set name = jsonb_build_object('vi', 'Kế toán ' || ${n}) where tenant_id = ${t} and key = 'ke-toan'`;
    await o`update admin.groups set name = jsonb_build_object('vi', 'Giám đốc ' || ${n}) where tenant_id = ${t} and key = 'giam-doc'`;
  }
  // flow Thư viện "Duyệt 2 cấp" (đã xuất bản) gán cho A; B chỉ có bản TẮT ⇒ không tính
  const st = JSON.stringify(STAGES);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version, enabled)
    values (null, 'cr125-s2-2cap', 'Duyệt 2 cấp', ${st}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true)
    returning id::text as id`;
  flowId = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${flowId}, 1, 'Duyệt 2 cấp', ${st}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${A}, ${flowId}, true, 0), (${B}, ${flowId}, false, 0)`;
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
  has_branches?: boolean;
  position?: number;
  start_when?: unknown;
  partner_send?: boolean;
  sign?: unknown;
  steps: { name: string; department_name: string | null; kind: string; approver_count?: number }[];
};

it("GET = flow Bật của company_flows: tên, bản, bước theo thứ tự, phòng ban theo tên công ty", async () => {
  const ra = await app(A, own).request("/approval-flow");
  const { items } = (await ra.json()) as { items: Out[] };
  const a = items[0] as Out;
  expect({
    count: items.length,
    status: ra.status,
    def_id: a.def_id,
    name: a.name,
    rel: a.rel_version,
    branches: a.has_branches,
    position: a.position,
    when: a.start_when,
    steps: a.steps.map((s) => [s.name, s.department_name, s.kind, s.approver_count]),
  }).toEqual({
    count: 1,
    status: 200,
    def_id: flowId,
    name: "Duyệt 2 cấp",
    rel: 1,
    branches: false,
    position: 0,
    when: null,
    steps: [
      ["Trưởng phòng duyệt", "Kế toán A", "review", 3],
      ["Giám đốc duyệt", "Giám đốc A", "review", undefined],
      ["Ký số", null, "esign", undefined],
    ],
  });
});

it("CR-184 · GET trả thêm `graph` = MỌI stage (cả Chờ ký xong, Kết thúc), phòng theo TÊN, `steps` cũ giữ nguyên", async () => {
  const ra = await app(A, own).request("/approval-flow");
  const { items } = (await ra.json()) as {
    items: {
      graph?: {
        key: string;
        kind: string;
        step: number;
        department_name?: string | null;
        terminal: boolean;
      }[];
    }[];
  };
  expect(
    (items[0]?.graph ?? []).map((g) => [
      g.key,
      g.kind,
      g.step,
      g.department_name ?? null,
      g.terminal,
    ]),
  ).toEqual([
    ["tp", "review", 0, "Kế toán A", false],
    ["gd", "review", 1, "Giám đốc A", false],
    ["ky", "esign", 2, null, false],
    ["cho", "wait", 3, null, true],
    ["end", "end", 4, null, true],
  ]);
});

it("flow bắt đầu bằng phiếu (trigger «không bao giờ», vd Quy trình mua hàng) KHÔNG được chọn làm quy trình duyệt HĐ", async () => {
  const never = JSON.stringify(NEVER_TRIGGER);
  const [m] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version, enabled)
    values (null, 'cr126-manual', 'Quy trình mua hàng', ${JSON.stringify(STAGES)}::text::jsonb, ${never}::text::jsonb, 'contracts', 1, true)
    returning id::text as id`;
  const mid = m?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${mid}, 1, 'Quy trình mua hàng', ${JSON.stringify(STAGES)}::text::jsonb)`;
  // id nhỏ nhất + cùng position ⇒ nếu không lọc thì đây là «flow đầu» (đúng ca e2e đỏ)
  await o`insert into hub.company_flows (id, tenant_id, flow_id, enabled, position) values ('00000000-0000-4000-8000-000000000001', ${A}, ${mid}, true, 0)`;
  try {
    const { items } = (await (await app(A, own).request("/approval-flow")).json()) as {
      items: Out[];
    };
    expect(items.map((x) => x.name)).toEqual(["Duyệt 2 cấp"]);
  } finally {
    await o`delete from hub.company_flows where flow_id = ${mid}`;
  }
});

it("công ty chỉ có flow Tắt ⇒ 200 `items: []`, PUT không còn route", async () => {
  const rb = await app(B, own).request("/approval-flow");
  expect([rb.status, await rb.json()]).toEqual([200, { items: [], can_edit: expect.any(Boolean) }]);
  const put = await app(A, own).request("/approval-flow", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, steps: [] }),
  });
  expect(put.status).toBe(404);
});

it("CR-127 Z9 · quy trình CỦA CÔNG TY (tạo trống → lưu → «Lưu và áp dụng»: KHÔNG có bản xuất bản) là flow đang bật: Cài đặt thấy nó và bộ điều phối (Gửi duyệt) chọn cùng flow", async () => {
  const st = JSON.stringify(STAGES);
  const [c] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, enabled)
    values (${B}, 'z9-cty', 'Duyệt của công ty B', ${st}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts', true)
    returning id::text as id`; // published_version NULL, không có process_def_releases
  const cid = c?.id as string;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${B}, ${cid}, true, 0)`;
  try {
    const rb = await app(B, own).request("/approval-flow");
    const b = ((await rb.json()) as { items: Out[] }).items[0] as Out;
    expect([rb.status, b.def_id, b.name, b.steps.length]).toEqual([
      200,
      cid,
      "Duyệt của công ty B",
      3,
    ]);
    const cands = await withHubScope(hubDb, { kind: "system" }, (tx) =>
      candidatesOf(tx, [{ tenant_id: B, event: "contract.submitted" } as ClaimedEvent]),
    );
    expect(cands.map((x) => x.flowId)).toEqual([cid]); // Gửi duyệt dùng ĐÚNG flow này (không bị NO_APPROVAL_FLOW)
  } finally {
    await o`delete from hub.company_flows where flow_id = ${cid}`;
  }
});

it("CR-146 · 3 flow Bật + 1 Tắt ⇒ đúng 3, đúng thứ tự `position`, đúng «Bắt đầu khi», tenant khác không thấy, số câu SQL cố định", async () => {
  const st = JSON.stringify(STAGES);
  const when = (v: number) => ({ op: "and", conds: [{ fact: "total_value", op: "ge", value: v }] });
  const mk = async (key: string, trig: object | null, on: boolean, pos: number) => {
    const t = JSON.stringify({ event: "contract.submitted", ...(trig ? { when: trig } : {}) });
    const [r] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, enabled)
      values (${B}, ${key}, ${key}, ${st}::text::jsonb, ${t}::text::jsonb, 'contracts', true) returning id::text as id`;
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${B}, ${r?.id as string}, ${on}, ${pos})`;
    return r?.id as string;
  };
  const ids = [
    await mk("c146-c", null, true, 30),
    await mk("c146-a", when(500), true, 10),
    await mk("c146-off", when(1), false, 15),
    await mk("c146-b", when(100), true, 20),
  ];
  try {
    const { items } = (await (await app(B, own).request("/approval-flow")).json()) as {
      items: Out[];
    };
    expect(items.map((x) => [x.name, x.position])).toEqual([
      ["c146-a", 10],
      ["c146-b", 20],
      ["c146-c", 30],
    ]);
    expect(
      items.map(
        (x) => (x.start_when as { conds: { value: number }[] } | null)?.conds[0]?.value ?? null,
      ),
    ).toEqual([500, 100, null]);
    const mine = (await (await app(A, own).request("/approval-flow")).json()) as { items: Out[] };
    expect(mine.items.map((x) => x.name)).toEqual(["Duyệt 2 cấp"]); // chéo tenant
    // flow thêm KHÔNG thêm câu SQL: eventFlows đúng MỘT câu cho cả danh sách
    const rows = await withHubScope(hubDb, { kind: "system" }, (tx) =>
      tx.execute(EVENT_FLOW_SQL(B, "contract.submitted")),
    );
    expect([...rows].length).toBe(3);
  } finally {
    await o`delete from hub.company_flows where flow_id = any(${ids}::uuid[])`;
  }
});
