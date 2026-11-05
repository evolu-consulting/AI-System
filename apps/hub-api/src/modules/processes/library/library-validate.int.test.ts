// CR-121 D-2 · int: xuất bản / gán quy trình thư viện ⇒ 422 kèm danh sách {bước, trường, câu tiếng Việt/Anh nói cách sửa}.
// Qua Hono thật + DB thật như `library.routes.int.test.ts` (khe `contracts.approval` thật).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { approvalEngineTools } from "../../packs/contracts/adapters/approval-engine.tools";
import { approvalSlotSpec } from "../../packs/contracts/approval.mount";
import {
  APPROVAL_DEFAULT_DEF,
  defaultSlotBody,
} from "../../packs/contracts/domain/approval-slot-default.rules";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "../defs/defs.routes";
import { libraryRoutes } from "./library.routes";

const SLOT = "contracts.approval";
const X = tenantId(1121);
const Y = tenantId(1122);
const DFLT = APPROVAL_DEFAULT_DEF.id;
const BAD = "c1210000-0000-4000-8000-000000000001";
const P = { userId: userId(1120), tenantId: X, role: "platform_admin" as Role };
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;

async function call(method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const D = (id: string) => `/process-defs/${id}`;

function catalog(): PackToolCatalog {
  slotRegistry.register(approvalSlotSpec);
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
    key: t.name,
    name: t.name,
    description: t.description,
    sideEffect: false,
    action: t.action,
    params: t.params,
  }));
  return {
    has: (k: string) => tools.some((t) => t.key === k),
    info: (k: string) => tools.find((t) => t.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((t) => !keys || keys.includes(t.key)),
  } as unknown as PackToolCatalog;
}

const KEYS = [
  "key",
  "name",
  "description",
  "input_hint",
  "run_group_ids",
  "stages",
  "token_budget",
];
const KEYS2 = ["enabled", "sources", "inputs", "ttl_days"];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1121', 'Công ty X'), (${Y}, 't1122', 'Công ty Y')`;
  await users(o, X, 1, { from: 1120 });
  await groups(o, X, ["contracts-editor", "contracts-owner", "sales"]);
  await groups(o, Y, ["contracts-editor", "contracts-owner"]);
  const deps = { db, packTools: catalog(), start: {} } as unknown as ProcessDeps;
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", P as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  app.route("/", defsRoutes(deps));
  app.route("/", libraryRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-121 · D-2 · kiểm khi xuất bản và gán", () => {
  it("xuất bản: điều kiện dùng trường chưa khai báo ⇒ 422 kèm bước + câu sửa tiếng Việt", async () => {
    const body = defaultSlotBody() as Json;
    body.steps.push({
      ...body.steps[0],
      key: "s2",
      name: "Bước hai",
      when: { op: "and", conds: [{ field: "foo_field", in: ["x"] }] },
    });
    await o`insert into hub.process_defs (id, tenant_id, key, name, stages, slot, slot_body)
      values (${BAD}, null, 'cr121-bad', 'cr121-bad', '[{"key":"s0"}]'::jsonb, ${SLOT}, ${o.json(body as never)})`;
    const v = (await call("GET", D(BAD))).json.version;
    const r = await call("POST", `${D(BAD)}/publish`, { version: v });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("PROCESS_PUBLISH_INVALID");
    const issue = r.json.error.details.issues[0];
    expect(issue).toMatchObject({
      step: 3,
      field: "when",
      rule: "COND_FIELD_UNDECLARED:foo_field",
    });
    expect(issue.message).toContain("Bước 3");
    expect(issue.message).toContain("foo_field");
    expect(issue.message_en).toContain("Step 3");
  });

  it("gán: mã phòng ban trong điều kiện không có ở công ty ⇒ 422 nói bước + công ty + cách sửa", async () => {
    const body = defaultSlotBody() as Json;
    body.steps.push({
      ...body.steps[0],
      key: "s2",
      name: "Bước hai",
      when: { op: "and", conds: [{ field: "creator_department", in: ["sales"] }] },
    });
    const cl = await call("POST", `${D(DFLT)}/clone`, { key: "cr121-dept", name: "QT cr121" });
    expect(cl.status).toBe(201);
    const id = cl.json.id as string;
    const cur = (await call("GET", D(id))).json;
    const input = Object.fromEntries([...KEYS, ...KEYS2].map((k) => [k, cur[k]]));
    const put = await call("PUT", D(id), {
      ...input,
      slot: SLOT,
      version: cur.version,
      slot_body: body,
    });
    expect(put.status).toBe(200);
    const pub = await call("POST", `${D(id)}/publish`, { version: put.json.version });
    expect(pub.status).toBe(201); // X có phòng 'sales'? xuất bản chưa gán ⇒ không kiểm tenant
    // Y thiếu 'sales' ⇒ 422; X đủ ⇒ gán được
    const bad = await call("PUT", `/tenants/${Y}/process-slots/${SLOT}`, { def_id: id });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("SLOT_GROUPS_MISSING");
    const issue = bad.json.error.details.issues[0];
    expect(issue).toMatchObject({ step: 3, rule: "GROUP_MISSING_IN_TENANT" });
    expect(issue.message).toContain("'sales'");
    expect(issue.message).toContain("t1122");
    expect(issue.message).toContain("tạo phòng ban");
    const ok = await call("PUT", `/tenants/${X}/process-slots/${SLOT}`, { def_id: id });
    expect(ok.status).toBe(200);
  });
});
