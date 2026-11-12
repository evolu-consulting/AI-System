// CR-122 · E1b · FLOW2-FR-05..09/20 · CR-127 Z7 · int (Hono thật `companyFlowsRoutes` + DB thật): vai + cách ly công ty (không còn đường gán mẫu dùng chung —
// POST chỉ còn tạo từ sơ đồ trống), chặn tắt flow không điều kiện cuối của sự kiện required, bản công ty có sẵn (dữ liệu cũ), xếp thứ tự.
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
import { seedCompanyCopy } from "../testing/company-copy-seed";
import { seedCompanyFlow } from "../testing/company-flow-seed";
import { companyFlowsRoutes } from "./company-flows.routes";

const X = tenantId(1251);
const Y = tenantId(1252);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1250), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1251), tenantId: X, role: "tenant_admin" },
  M: { userId: userId(1252), tenantId: X, role: "member" },
  AY: { userId: userId(1253), tenantId: Y, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let lib = "";
let libCond = "";
let legacySrc = "";
let defY = "";
let gx: Map<string, string>;

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
/** Def Thư viện CŨ (dữ liệu trước CR-127): chỉ làm nguồn cho bản sao có sẵn, KHÔNG gán cho công ty. */
async function libDef(key: string, trigger: object): Promise<string> {
  const st = JSON.stringify([{ key: "dau", executor: { kind: "set", values: [] } }]);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app,
      published_version) values (null, ${key}, ${key}, ${st}::text::jsonb, ${o.json(trigger as never)}, 'contracts', 1)
    returning id::text as id`;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages)
    values (${r?.id as string}, 1, ${key}, ${st}::text::jsonb)`;
  return r?.id as string;
}
const rowOf = (j: Json, flowId: string) => (j.items as Json[]).find((x) => x.flow_id === flowId);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1251', 'X'), (${Y}, 't1252', 'Y')`;
  await users(o, X, 3, { from: 1250 });
  await users(o, Y, 1, { from: 1253 });
  gx = await groups(o, X, ["kinh-doanh"]);
  lib = (
    await seedCompanyFlow(o, {
      tenantId: X,
      key: "e1b-duyet",
      trigger: { event: "contract.submitted" },
    })
  ).flowId;
  libCond = (
    await seedCompanyFlow(o, {
      tenantId: X,
      key: "e1b-lon",
      trigger: {
        event: "contract.submitted",
        when: { op: "and", conds: [{ fact: "total_value", op: "ge", value: 1 }] },
      },
    })
  ).flowId;
  legacySrc = await libDef("e1b-cu", { event: "contract.submitted" });
  const [y] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
    values (${Y}, 'e1b-y', 'Y', '[{"key":"a"}]'::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts') returning id::text as id`;
  defY = y?.id as string;
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

describe("CR-122 E1b · company-flows", () => {
  it("vai + cách ly: tạo chỉ platform_admin (tenant_admin 403), member 403, công ty khác 404, dạng gán {flow_id} đã gỡ ⇒ 400, không lộ def công ty khác", async () => {
    const blank = { name: "Mới", app: "contracts", from: "blank" };
    expect((await call("A", "POST", P(X), blank)).status).toBe(403);
    expect((await call("P", "POST", P(X), { flow_id: lib })).status).toBe(400); // CR-127 Z7
    const l = await call("A", "GET", P(X));
    expect(rowOf(l.json, lib)).toMatchObject({
      kind: "company",
      enabled: true,
      trigger_event: "contract.submitted",
      deletable: false, // đã áp dụng ⇒ không xoá (Tắt thay)
    });
    expect((await call("M", "GET", P(X))).status).toBe(403);
    expect((await call("AY", "GET", P(X))).status).toBe(404);
    // ghi tay dòng trỏ def của Y (bỏ qua service) ⇒ danh sách X không hiện def của Y
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${defY}, true)`;
    const l2 = await call("A", "GET", P(X));
    expect(rowOf(l2.json, defY)).toBeUndefined();
    await o`delete from hub.company_flows where flow_id = ${defY}`;
  });

  it("tắt flow không điều kiện cuối của sự kiện required ⇒ 409, có flow khác không điều kiện thì tắt được", async () => {
    const l = await call("A", "GET", P(X));
    const id = rowOf(l.json, lib)?.id as string;
    const t = await call("P", "PATCH", `${P(X)}/${id}`, { enabled: false });
    expect([t.status, t.json.error?.code ?? t.json.code]).toEqual([409, "FLOW_REQUIRED_LAST"]);
    // libCond (có điều kiện) đã Bật từ đầu ⇒ không tính lưới cuối
    expect((await call("P", "PATCH", `${P(X)}/${id}`, { enabled: false })).status).toBe(409);
  });

  it("bản công ty có sẵn (dữ liệu cũ, không còn đường sao chép): hiện Tắt chưa xuất bản kèm nguồn; không có route sao chép ⇒ 403/404", async () => {
    const l = await call("A", "GET", P(X));
    const id = rowOf(l.json, lib)?.id as string;
    const made = await seedCompanyCopy(o, {
      tenantId: X,
      srcFlowId: legacySrc,
      actor: userId(1250),
      bind: { "kinh-doanh": gx.get("kinh-doanh") as string },
    });
    const l2 = await call("A", "GET", P(X));
    const copy = rowOf(l2.json, made.flowId);
    expect(copy).toMatchObject({ kind: "company", enabled: false, off_reason: "not_published" });
    expect(copy?.source).toMatchObject({ flow_key: "e1b-cu", version: 1 });
    const gone = await app.request(`${P(X)}/${id}/clone`, {
      method: "POST",
      headers: { "x-who": "P" },
    });
    expect(gone.status).toBe(404); // CR-127 · Z5: tạo quy trình công ty chỉ từ sơ đồ trống
  });

  it("CR-127 Z9 · cảnh báo group_missing cùng luật reviewHasGroup: «cùng duyệt» đủ nhóm ⇒ không cảnh báo; thiếu nhóm / bước Duyệt không nhóm ⇒ cảnh báo; chỉ người duyệt ⇒ không", async () => {
    const g = gx.get("kinh-doanh") as string;
    const review = (after: object) => [
      {
        key: "d",
        name: "D",
        step: 0,
        executor: { kind: "approve" },
        after: { kind: "review", ...after },
      },
      {
        key: "xong",
        name: "Xong",
        step: 1,
        outcome: "approved",
        executor: { kind: "set", values: [] },
      },
    ];
    const mk = async (key: string, after: object) =>
      (
        await seedCompanyFlow(o, {
          tenantId: X,
          key,
          trigger: { event: "contract.approved" },
          stages: review(after),
          position: 50,
        })
      ).flowId;
    const ok = await mk("z9-par-ok", {
      group_id: null,
      parallel: { rule: "all", groups: [{ group_id: g }, { group_key: "giam-doc" }] },
    });
    const bad = await mk("z9-par-bad", {
      group_id: null,
      parallel: { rule: "all", groups: [{ group_id: g }, {}] },
    });
    const none = await mk("z9-none", { group_id: null });
    const user = await mk("z9-user", { group_id: null, approver_user_id: userId(1250) });
    const l = await call("P", "GET", P(X));
    const w = (id: string) =>
      ((rowOf(l.json, id)?.warnings ?? []) as string[]).includes("group_missing");
    expect([w(ok), w(bad), w(none), w(user)]).toEqual([false, true, true, false]);
  });

  it("xếp thứ tự: đủ id ⇒ position theo mảng, thiếu/lạ ⇒ 422", async () => {
    const l = await call("A", "GET", P(X));
    const ids = (l.json.items as Json[]).map((x) => x.id).reverse();
    const r = await call("P", "PUT", `${P(X)}/order`, { ids });
    expect(r.status).toBe(200);
    expect((r.json.items as Json[]).map((x) => x.id)).toEqual(ids);
    const bad = await call("P", "PUT", `${P(X)}/order`, { ids: ids.slice(1) });
    expect(bad.status).toBe(422);
  });
});
