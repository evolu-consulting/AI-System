// contract-flow S2 · `GET|PUT /pack/contracts/approval-flow` (route thật + pool hub_api + RLS gói + Group thật ở `admin.groups`):
// chưa lưu ⇒ mẫu mặc định 2 bước (version 1, `is_default`); owner PUT ⇒ version 2, GET đọc lại; version cũ ⇒ 409; nhóm của tenant
// khác ⇒ 422 APPROVAL_GROUP_MISSING; editor PUT ⇒ 403 PACK_FORBIDDEN.
import { afterAll, beforeAll, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { enablePack, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import { packGroups } from "../../kit/adapters/pack-groups";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../../kit/adapters/pack-uow";
import {
  listDifyWorkflows,
  readApprovalFlow,
  saveApprovalFlow,
} from "../application/approval-flow.usecase";
import { approvalFlowRepo } from "./approval-flow.repo";
import { approvalFlowRoutes } from "./approval-flow.routes";

let sql: Sql;
let db: Db;
let A = "";
let B = "";
let own = "";
let ed = "";
let gA: Record<string, string> = {};
let gB: Record<string, string> = {};
const F = { read: "f-r", write: "f-w", admin: "f-a" };

const HAN_MUC = {
  key: "dify-han-muc-duyet",
  name: "Hạn mức duyệt",
  params: [
    { name: "contract_value", type: "number", required: true },
    { name: "contract_type", type: "text", required: true },
  ],
};

function app(user: string, groups: string[], workflows: unknown[] = []) {
  const view: PackAccessView = {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
      ],
      entitled: new Set(Object.values(F).map((f) => `${A}:${f}`)),
      grantGroups: new Map([
        [`${A}:${F.read}`, ["g-own", "g-edit"]],
        [`${A}:${F.write}`, ["g-own", "g-edit"]],
        [`${A}:${F.admin}`, ["g-own"]],
      ]),
    }),
    user: async () => ({ tenantId: A, groupIds: new Set(groups) }),
  };
  const uow = createPackUow(db, "contracts", (tx, tid) => ({
    approvalFlow: approvalFlowRepo(tx, tid),
  }));
  const d = {
    uow,
    groups: packGroups(db, view, "contracts"),
    ...(workflows.length ? { workflows: async () => workflows as never } : {}),
  };
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", { userId: user, tenantId: A, role: "member" } as never);
    await next();
  });
  h.route(
    "/",
    approvalFlowRoutes(view, {
      read: readApprovalFlow(d),
      save: saveApprovalFlow(d),
      difyWorkflows: listDifyWorkflows(d),
    }),
  );
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}
type Out = {
  version: number;
  is_default: boolean;
  steps: { department_group_id: string; exclude_starter: boolean }[];
  error?: { code: string; details?: { issues?: unknown; current?: { version: number } } };
};
const call = async (h: Hono<PackGuardVars>, method: string, body?: unknown) => {
  const r = await h.request("/approval-flow", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, json: (await r.json()) as Out };
};
const step = (key: string, group: string, o: Record<string, unknown> = {}) => ({
  kind: "review",
  key,
  name: key,
  department_group_id: group,
  head_only: false,
  due_h: 48,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when: null,
  ...o,
});

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 871)) as [string, string];
  [own, ed] = (await users(sql, A, 2, { from: 871 })) as [string, string];
  const roles = await enablePack(sql, [A, B], "contracts");
  gA = roles.get(A) as Record<string, string>;
  gB = roles.get(B) as Record<string, string>;
  db = createDb(urls().hubApi, { max: 3 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const err = (r: Awaited<ReturnType<typeof call>>) => ({
  status: r.status,
  code: r.json.error?.code,
});
const steps = () => [
  step("sales", gA.editor as string),
  step("legal", gA.viewer as string, { escalate_group_id: gA.owner }),
  step("dir", gA.owner as string, {
    exclude_starter: true,
    when: { op: "or", conds: [{ field: "total_value", op: "ge", value: 1_000_000_000 }] },
  }),
];

it("chưa lưu ⇒ mẫu mặc định 2 bước (nhóm editor → owner, cấp 2 chặn người gửi), version 1", async () => {
  const d = await call(app(own, ["g-own"]), "GET");
  expect({
    status: d.status,
    version: d.json.version,
    is_default: d.json.is_default,
    groups: d.json.steps.map((s) => s.department_group_id),
    excl: d.json.steps.map((s) => s.exclude_starter),
  }).toEqual({
    status: 200,
    version: 1,
    is_default: true,
    groups: [gA.editor as string, gA.owner as string],
    excl: [false, true],
  });
});

it("owner PUT 3 bước ⇒ version 2; GET đọc lại đúng; hàng DB version 2", async () => {
  const owner = app(own, ["g-own"]);
  const p = await call(owner, "PUT", { version: 1, steps: steps() });
  expect({ status: p.status, version: p.json.version, is_default: p.json.is_default }).toEqual({
    status: 200,
    version: 2,
    is_default: false,
  });
  const g = await call(owner, "GET");
  expect({ version: g.json.version, steps: g.json.steps }).toEqual({ version: 2, steps: steps() });
  const [row] = await sql<{ version: number }[]>`select version from contracts.approval_flows
    where tenant_id = ${A}`;
  expect(row?.version).toBe(2);
});

it("version cũ ⇒ 409 (details.current); nhóm tenant khác ⇒ 422 GROUP_MISSING; luật ⇒ 422 issues", async () => {
  const owner = app(own, ["g-own"]);
  const stale = await call(owner, "PUT", { version: 1, steps: steps() });
  expect({ ...err(stale), cur: stale.json.error?.details?.current?.version }).toEqual({
    status: 409,
    code: "VERSION_CONFLICT",
    cur: 2,
  });
  const foreign = await call(owner, "PUT", { version: 2, steps: [step("x", gB.owner as string)] });
  expect(err(foreign)).toEqual({ status: 422, code: "APPROVAL_GROUP_MISSING" });
  const same = { escalate_group_id: gA.owner };
  const bad = await call(owner, "PUT", {
    version: 2,
    steps: [step("x", gA.owner as string, same)],
  });
  expect({ ...err(bad), issues: bad.json.error?.details?.issues }).toEqual({
    status: 422,
    code: "APPROVAL_FLOW_INVALID",
    issues: [{ path: "steps.0.escalate_group_id", rule: "ESCALATE_SAME_GROUP" }],
  });
});

it("editor (không admin gói) PUT ⇒ 403 PACK_FORBIDDEN; GET vẫn đọc được", async () => {
  const editor = app(ed, ["g-edit"]);
  const r = await call(editor, "PUT", { version: 2, steps: [step("x", gA.owner as string)] });
  expect(err(r)).toEqual({ status: 403, code: "PACK_FORBIDDEN" });
  expect((await call(editor, "GET")).status).toBe(200);
});

it("dify-input-map · tham số bắt buộc khác tên nhận được khi ánh xạ; khoá ánh xạ lạ ⇒ 422 DIFY_INPUT_UNKNOWN", async () => {
  const owner = app(own, ["g-own"], [HAN_MUC]);
  const dify = (inputs?: Record<string, string>) => ({
    kind: "dify",
    key: "d1",
    name: "Hạn mức",
    workflow_key: HAN_MUC.key,
    ...(inputs ? { inputs } : {}),
    after: "auto",
  });
  const body = (inputs?: Record<string, string>) => ({
    version: 2,
    steps: [step("sales", gA.editor as string), dify(inputs)],
  });
  const none = await call(owner, "PUT", body());
  expect({ ...err(none), issues: none.json.error?.details?.issues }).toEqual({
    status: 422,
    code: "APPROVAL_FLOW_INVALID",
    issues: [{ path: "steps.1.workflow_key", rule: "DIFY_PARAM_UNSUPPORTED" }],
  });
  const unknown = await call(
    owner,
    "PUT",
    body({ contract_value: "total_value", contract_type: "deal", nope: "title" }),
  );
  expect(unknown.json.error?.details?.issues).toEqual([
    { path: "steps.1.inputs.nope", rule: "DIFY_INPUT_UNKNOWN" },
  ]);
  const ok = await call(
    owner,
    "PUT",
    body({ contract_value: "total_value", contract_type: "deal" }),
  );
  expect(ok.status).toBe(200);
  const g = await call(owner, "GET");
  expect(JSON.stringify(g.json.steps[1])).toContain('"contract_value":"total_value"');
  const list = (await (await owner.request("/dify-workflows")).json()) as {
    items: { inputs: { name: string }[] }[];
  };
  expect(list.items[0]?.inputs.map((i) => i.name)).toEqual(["contract_value", "contract_type"]);
});
