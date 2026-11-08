// CR-123 · FLOW3-FR-10 · int (Hono thật + DB thật): `POST /tenants/:tid/company-flows/apply` = "Lưu và áp dụng" bước áp dụng — bản công ty
// thành flow đang dùng của sự kiện, thay bản gốc Thư viện trong MỘT tx (lỗi giữa chừng ⇒ không đổi gì), chặn bước duyệt thiếu nhóm,
// tạo dòng cho def tự tạo, cách ly công ty + vai.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { companyFlowsRoutes } from "./company-flows.routes";

const X = tenantId(1261);
const Y = tenantId(1262);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1260), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1261), tenantId: X, role: "tenant_admin" },
  M: { userId: userId(1262), tenantId: X, role: "member" },
  AY: { userId: userId(1263), tenantId: Y, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let lib = "";

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const P = (t: string) => `/tenants/${t}/company-flows`;
const code = (j: Json) => j.error?.code ?? j.code;
const rowOf = (j: Json, flowId: string) => (j.items as Json[]).find((x) => x.flow_id === flowId);
const stages = (group: string, review = false) => [
  {
    key: "dau",
    name: "Đầu",
    step: 0,
    executor: { kind: "set", values: [] },
    after: review ? { kind: "review", group_id: "" } : { kind: "auto", branch: [] },
    answerer: { kind: "group", group_key: group },
    real_action: false,
  },
  {
    key: "xong",
    name: "Xong",
    step: 1,
    outcome: "approved",
    executor: { kind: "set", values: [] },
  },
];

async function libDef(key: string, trigger: object, group: string): Promise<string> {
  const st = JSON.stringify(stages(group));
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app,
      published_version) values (null, ${key}, ${key}, ${st}::text::jsonb, ${o.json(trigger as never)}, 'contracts', 1)
    returning id::text as id`;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages)
    values (${r?.id as string}, 1, ${key}, ${st}::text::jsonb)`;
  return r?.id as string;
}
/** Gán Thư viện cho công ty rồi "Sao chép để sửa": trả { orig, copy } (dòng company_flows). */
async function cloned(t: string, who: string): Promise<{ orig: Json; copy: Json }> {
  await call("P", "POST", P(t), { flow_id: lib });
  const l = await call(who, "GET", P(t));
  const orig = rowOf(l.json, lib) as Json;
  const c = await call(who, "POST", `${P(t)}/${orig.id}/clone`);
  const copy = (c.json.items as Json[]).find((x) => x.id === c.json.id) as Json;
  return { orig, copy };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1261', 'X'), (${Y}, 't1262', 'Y')`;
  await users(o, X, 3, { from: 1260 });
  await users(o, Y, 1, { from: 1263 });
  await groups(o, X, ["kinh-doanh"]);
  lib = await libDef("u7-duyet", { event: "contract.submitted" }, "kinh-doanh");
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
  app.route("/", companyFlowsRoutes({ db } as unknown as ProcessDeps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-123 FR-10 · company-flows/apply", () => {
  it("một lần áp dụng ⇒ bản công ty Bật, gốc Thư viện Tắt (replaced_by) trong cùng phản hồi, áp dụng lại không đổi", async () => {
    const { orig, copy } = await cloned(X, "A");
    expect(copy).toMatchObject({ enabled: false, off_reason: "not_published" });
    const a = await call("A", "POST", `${P(X)}/apply`, { flow_id: copy.flow_id });
    expect(a.status).toBe(200);
    expect(a.json.id).toBe(copy.id);
    expect(rowOf(a.json, copy.flow_id)).toMatchObject({ enabled: true, off_reason: null });
    expect(rowOf(a.json, lib)).toMatchObject({
      enabled: false,
      off_reason: "replaced",
      replaced_by: copy.id,
    });
    // một nguồn "đang dùng": đúng một dòng Bật cho sự kiện này
    const on = (a.json.items as Json[]).filter(
      (x) => x.trigger_event === "contract.submitted" && x.enabled,
    );
    expect(on.map((x) => x.id)).toEqual([copy.id]);
    // audit trong cùng tx: ai áp dụng quy trình nào, thay bản gốc nào
    const au = await o<
      { summary: Json; actor_id: string }[]
    >`select summary, actor_id::text as actor_id from hub.audit_log
      where tenant_id = ${X} and entity_name = 'company_flow.apply' order by seq desc limit 1`;
    expect(au[0]?.summary).toMatchObject({ flow_id: copy.flow_id, replaced_flow_id: lib });
    expect(au[0]?.actor_id).toBe(WHO.A?.userId as string);
    const b = await call("A", "POST", `${P(X)}/apply`, { flow_id: copy.flow_id });
    expect(b.status).toBe(200);
    expect(rowOf(b.json, copy.flow_id)?.enabled).toBe(true);
    expect(orig.id).toBeTruthy();
  });

  it("nguyên tử: bản công ty có điều kiện thay gốc không điều kiện cuối của sự kiện required ⇒ 409 và KHÔNG đổi dòng nào", async () => {
    const { copy } = await cloned(X, "A"); // đã áp dụng ở ca trên: quay về gốc để có trạng thái gốc Bật
    await call("A", "POST", `${P(X)}/${copy.id}/revert`);
    await o`update hub.process_defs set trigger = ${o.json({ event: "contract.submitted", when: { op: "and", conds: [{ fact: "total_value", op: "ge", value: 1 }] } } as never)}
      where id = ${copy.flow_id}`;
    const before = await call("A", "GET", P(X));
    const r = await call("A", "POST", `${P(X)}/apply`, { flow_id: copy.flow_id });
    expect([r.status, code(r.json)]).toEqual([409, "FLOW_REQUIRED_LAST"]);
    const after = await call("A", "GET", P(X));
    expect(after.json).toEqual(before.json);
    expect(rowOf(after.json, lib)?.enabled).toBe(true);
    expect(rowOf(after.json, copy.flow_id)?.enabled).toBe(false);
  });
});

describe("CR-123 FR-10 · company-flows/apply · lỗi, cách ly", () => {
  it("còn bước duyệt chưa chọn nhóm ⇒ 422 FLOW_GROUP_MISSING, không đổi gì", async () => {
    await call("P", "POST", P(Y), { flow_id: lib });
    const l = await call("AY", "GET", P(Y));
    const c = await call("AY", "POST", `${P(Y)}/${rowOf(l.json, lib)?.id}/clone`);
    const copy = (c.json.items as Json[]).find((x) => x.id === c.json.id) as Json;
    await o`update hub.process_defs set stages = ${JSON.stringify(stages("kinh-doanh", true))}::text::jsonb where id = ${copy.flow_id}`;
    const r = await call("AY", "POST", `${P(Y)}/apply`, { flow_id: copy.flow_id });
    expect([r.status, code(r.json)]).toEqual([422, "FLOW_GROUP_MISSING"]);
    const after = await call("AY", "GET", P(Y));
    expect(rowOf(after.json, lib)?.enabled).toBe(true);
    expect(rowOf(after.json, copy.flow_id)?.enabled).toBe(false);
  });

  it("def tự tạo của công ty chưa có dòng ⇒ tạo dòng Bật; thiếu Bắt đầu khi ⇒ 422", async () => {
    const [own] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
      values (${X}, 'u7-own', 'Riêng', ${JSON.stringify(stages("kinh-doanh"))}::text::jsonb, '{"event":"contract.approved"}'::jsonb, 'contracts')
      returning id::text as id`;
    const a = await call("A", "POST", `${P(X)}/apply`, { flow_id: own?.id });
    expect(a.status).toBe(200);
    expect(rowOf(a.json, own?.id as string)).toMatchObject({ kind: "company", enabled: true });
    const [none] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages) values (${X}, 'u7-none', 'Không trigger', '[{"key":"a"}]'::jsonb)
      returning id::text as id`;
    const n = await call("A", "POST", `${P(X)}/apply`, { flow_id: none?.id });
    expect([n.status, code(n.json)]).toEqual([422, "FLOW_NOT_ASSIGNABLE"]);
  });

  it("cách ly: member 403, quản trị công ty khác 404, def của công ty khác không áp dụng được và không lộ", async () => {
    const [dy] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
      values (${Y}, 'u7-y', 'Y', '[{"key":"a"}]'::jsonb, '{"event":"contract.approved"}'::jsonb, 'contracts') returning id::text as id`;
    expect((await call("M", "POST", `${P(X)}/apply`, { flow_id: lib })).status).toBe(403);
    expect((await call("AY", "POST", `${P(X)}/apply`, { flow_id: lib })).status).toBe(404);
    const r = await call("A", "POST", `${P(X)}/apply`, { flow_id: dy?.id });
    expect([r.status, code(r.json)]).toEqual([422, "FLOW_NOT_ASSIGNABLE"]);
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.company_flows where flow_id = ${dy?.id as string}`;
    expect(n?.n).toBe(0);
  });
});
