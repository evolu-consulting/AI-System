// CR-125 · c5 · int (Hono thật `companyFlowsRoutes` + DB thật): công ty không bao giờ nhận mẫu mà nó không áp dụng được.
// Gán (platform) và sao chép (công ty) mẫu cần tính năng chưa bật ⇒ 422 FLOW_TEMPLATE_NOT_READY nêu tính năng + ai cần làm gì;
// mẫu chỉ cần bước lõi ⇒ gán + sao chép được, nhóm duyệt `community-admin` khớp nhóm chủ gói `community-owner` (không đoán nhóm khác);
// công ty chưa có nhóm nào khớp ⇒ bước để trống ("Chọn người duyệt") + cảnh báo, không chặn.
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

const X = tenantId(1271); // có nhóm chủ gói community-owner
const Z = tenantId(1272); // chưa có nhóm nào
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1270), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1271), tenantId: X, role: "tenant_admin" },
  AZ: { userId: userId(1273), tenantId: Z, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let okTpl = "";
let needFeature = "";
let gOwner = "";

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
const code = (r: { json: Json }) => r.json.error?.code ?? r.json.code;

const end = {
  key: "xong",
  name: "Xong",
  step: 1,
  outcome: "shown",
  executor: { kind: "set", values: [] },
};
const approve = {
  key: "duyet",
  name: "Duyệt bài",
  step: 0,
  executor: { kind: "approve", reject_step: 1, return_step: 1 },
  after: { kind: "review", group_key: "community-admin", branch: [] },
  answerer: { kind: "starter" },
  real_action: false,
};
/** Bước Hiện bài = node của tính năng `community-write` (công ty X/Z chưa được cấp). */
const showPost = { ...approve, key: "hien", name: "Hiện bài", node: "community.show-post" };

async function libDef(key: string, stages: object[]): Promise<string> {
  const st = JSON.stringify(stages);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version)
    values (null, ${key}, ${key}, ${st}::text::jsonb, '{"event":"post.created"}'::jsonb, 'community', 1)
    returning id::text as id`;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages)
    values (${r?.id as string}, 1, ${key}, ${st}::text::jsonb)`;
  return r?.id as string;
}
const rowOf = (j: Json, id: string) => (j.items as Json[]).find((x) => x.id === id);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1271', 'X'), (${Z}, 't1272', 'Z')`;
  await users(o, X, 2, { from: 1270 });
  await users(o, Z, 1, { from: 1273 });
  gOwner = [...(await groups(o, X, ["community-owner"])).values()][0] as string;
  okTpl = await libDef("c5-ok", [approve, end]);
  needFeature = await libDef("c5-need", [showPost, end]);
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

describe("CR-125 c5 · mẫu dùng được ở công ty", () => {
  it("readiness: mẫu cần tính năng chưa bật ⇒ not ready nêu tính năng; mẫu lõi ⇒ ready + nhóm khớp", async () => {
    const bad = await call("P", "GET", `${P(X)}/readiness/${needFeature}`);
    expect(bad.status).toBe(200);
    expect(bad.json.ready).toBe(false);
    expect(bad.json.missing.features[0]).toMatchObject({
      key: "community-write",
      stage: "Hiện bài",
    });
    const ok = await call("A", "GET", `${P(X)}/readiness/${okTpl}`);
    expect(ok.json.ready).toBe(true);
    expect(ok.json.groupMap).toEqual({ "community-admin": "community-owner" });
  });

  it("gán mẫu chưa dùng được ⇒ 422 FLOW_TEMPLATE_NOT_READY nêu tính năng, không ghi gì", async () => {
    const r = await call("P", "POST", P(X), { flow_id: needFeature });
    expect([r.status, code(r)]).toEqual([422, "FLOW_TEMPLATE_NOT_READY"]);
    expect(JSON.stringify(r.json)).toContain("community-write");
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.company_flows where tenant_id = ${X}`;
    expect(n?.n).toBe(0);
  });

  it("sao chép mẫu chưa dùng được (dòng gán sẵn) ⇒ 422, công ty được dặn nhờ quản trị nền tảng bật", async () => {
    const [cf] = await o<
      { id: string }[]
    >`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${needFeature}, true) returning id::text as id`;
    const r = await call("A", "POST", `${P(X)}/${cf?.id}/clone`);
    expect([r.status, code(r)]).toEqual([422, "FLOW_TEMPLATE_NOT_READY"]);
    expect(JSON.stringify(r.json)).toContain("READINESS_FEATURE_MISSING");
    expect(JSON.stringify(r.json)).toContain('"audience":"company"');
    await o`delete from hub.company_flows where tenant_id = ${X}`;
  });

  it("mẫu dùng được: gán 201; công ty sao chép ⇒ nhóm duyệt = nhóm chủ gói của công ty, không cảnh báo thiếu nhóm", async () => {
    const a = await call("P", "POST", P(X), { flow_id: okTpl });
    expect(a.status).toBe(201);
    const row = (a.json.items as Json[]).find((x) => x.flow_id === okTpl) as Json;
    const c = await call("A", "POST", `${P(X)}/${row.id}/clone`);
    expect(c.status).toBe(201);
    expect(c.json.missing_group_keys).toBeUndefined();
    const copy = rowOf(c.json, c.json.id) as Json;
    const [d] = await o<
      { stages: Json[] }[]
    >`select stages from hub.process_defs where id = ${copy.flow_id}`;
    expect(d?.stages[0]?.after.group_id).toBe(gOwner);
    expect(d?.stages[0]?.after.group_key).toBeUndefined();
  });

  it("công ty chưa có nhóm khớp ⇒ sao chép được nhưng bước để trống + nêu nhóm thiếu (không gán nhầm nhóm khác)", async () => {
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${Z}, ${okTpl}, true)`;
    const l = await call("AZ", "GET", P(Z));
    const row = (l.json.items as Json[]).find((x) => x.flow_id === okTpl) as Json;
    const c = await call("AZ", "POST", `${P(Z)}/${row.id}/clone`);
    expect(c.status).toBe(201);
    expect(c.json.missing_group_keys).toEqual(["community-admin"]);
    const copy = rowOf(c.json, c.json.id) as Json;
    const [d] = await o<
      { stages: Json[] }[]
    >`select stages from hub.process_defs where id = ${copy.flow_id}`;
    expect(d?.stages[0]?.after.group_id).toBeNull();
  });
});
