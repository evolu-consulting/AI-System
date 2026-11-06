// CR-122 · E1b · FLOW2-FR-05..09/20 · int (Hono thật `companyFlowsRoutes` + DB thật): gán (platform_admin), vai + cách ly công ty,
// chặn trỏ def của công ty khác (soát E1 #2), chặn tắt flow không điều kiện cuối của sự kiện required, "Sao chép để sửa" (Group theo
// mã → id; bấm lần hai trả bản cũ; thiếu phòng ⇒ 422 nêu mã), xuất bản bản sao ⇒ gốc Tắt (một tx), "Quay về bản gốc", xếp thứ tự.
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
const stages = (group?: string) => [
  {
    key: "dau",
    name: "Đầu",
    step: 0,
    executor: { kind: "set", values: [] },
    after: { kind: "auto", branch: [] },
    answerer: group ? { kind: "group", group_key: group } : { kind: "starter" },
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

/** Def Thư viện đã xuất bản v1 có trigger. */
async function libDef(key: string, trigger: object, group?: string): Promise<string> {
  const st = JSON.stringify(stages(group));
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app,
      published_version, slot) values (null, ${key}, ${key}, ${st}::text::jsonb, ${o.json(trigger as never)}, 'contracts', 1,
      'contracts.approval')
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
  lib = await libDef("e1b-duyet", { event: "contract.submitted" }, "kinh-doanh");
  libCond = await libDef("e1b-lon", {
    event: "contract.submitted",
    when: { op: "and", conds: [{ fact: "total_value", op: "ge", value: 1 }] },
  });
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
  it("gán: platform_admin được, tenant_admin 403, vai: member 403, công ty khác 404, def công ty khác 422 và không lộ", async () => {
    expect((await call("A", "POST", P(X), { flow_id: lib })).status).toBe(403);
    const a = await call("P", "POST", P(X), { flow_id: lib });
    expect(a.status).toBe(201);
    expect(rowOf(a.json, lib)).toMatchObject({
      kind: "assigned",
      enabled: true,
      trigger_event: "contract.submitted",
    });
    expect((await call("M", "GET", P(X))).status).toBe(403);
    expect((await call("AY", "GET", P(X))).status).toBe(404);
    const bad = await call("P", "POST", P(X), { flow_id: defY });
    expect([bad.status, bad.json.error?.code ?? bad.json.code]).toEqual([
      422,
      "FLOW_NOT_ASSIGNABLE",
    ]);
    // ghi tay dòng trỏ def của Y (bỏ qua service) ⇒ danh sách X không hiện def của Y
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${defY}, true)`;
    const l = await call("A", "GET", P(X));
    expect(rowOf(l.json, defY)).toBeUndefined();
    await o`delete from hub.company_flows where flow_id = ${defY}`;
  });

  it("tắt flow không điều kiện cuối của sự kiện required ⇒ 409, có flow khác không điều kiện thì tắt được", async () => {
    const l = await call("A", "GET", P(X));
    const id = rowOf(l.json, lib)?.id as string;
    const t = await call("A", "PATCH", `${P(X)}/${id}`, { enabled: false });
    expect([t.status, t.json.error?.code ?? t.json.code]).toEqual([409, "FLOW_REQUIRED_LAST"]);
    await call("P", "POST", P(X), { flow_id: libCond }); // có điều kiện ⇒ không tính lưới cuối
    expect((await call("A", "PATCH", `${P(X)}/${id}`, { enabled: false })).status).toBe(409);
  });

  it("sao chép để sửa: bản công ty Tắt chưa xuất bản, Group mã → id, lần hai trả bản cũ, công ty thiếu phòng ⇒ 422 nêu mã", async () => {
    const l = await call("A", "GET", P(X));
    const id = rowOf(l.json, lib)?.id as string;
    const c1 = await call("A", "POST", `${P(X)}/${id}/clone`);
    expect(c1.status).toBe(201);
    const copy = (c1.json.items as Json[]).find((x) => x.id === c1.json.id);
    expect(copy).toMatchObject({ kind: "company", enabled: false, off_reason: "not_published" });
    expect(copy?.source).toMatchObject({ flow_key: "e1b-duyet", version: 1 });
    const [d] = await o<
      { s: Json[]; t: Json }[]
    >`select stages as s, trigger as t from hub.process_defs where id = ${copy?.flow_id}`;
    expect(d?.s[0]?.answerer.group_id).toBe(gx.get("kinh-doanh"));
    expect(d?.t).toEqual({ event: "contract.submitted" });
    const c2 = await call("A", "POST", `${P(X)}/${id}/clone`);
    expect(c2.json.id).toBe(c1.json.id);
    await call("P", "POST", P(Y), { flow_id: lib });
    const ly = await call("AY", "GET", P(Y));
    const cy = await call("AY", "POST", `${P(Y)}/${rowOf(ly.json, lib)?.id}/clone`);
    expect([cy.status, cy.json.error?.code ?? cy.json.code]).toEqual([422, "GROUPS_MISSING"]);
  });

  it("xuất bản bản sao ⇒ bản sao Bật + gốc Tắt (replaced_by), quay về bản gốc ⇒ đảo lại, bản sao giữ (reverted)", async () => {
    const l = await call("A", "GET", P(X));
    const orig = rowOf(l.json, lib);
    const copy = (l.json.items as Json[]).find((x) => x.kind === "company");
    const p = await call("A", "POST", `${P(X)}/${copy?.id}/publish`);
    expect(p.status).toBe(200);
    expect(rowOf(p.json, lib)).toMatchObject({
      enabled: false,
      off_reason: "replaced",
      replaced_by: copy?.id,
    });
    expect(rowOf(p.json, copy?.flow_id)).toMatchObject({ enabled: true, off_reason: null });
    const r = await call("A", "POST", `${P(X)}/${copy?.id}/revert`);
    expect(rowOf(r.json, lib)).toMatchObject({
      enabled: true,
      off_reason: null,
      replaced_by: null,
    });
    expect(rowOf(r.json, copy?.flow_id)).toMatchObject({ enabled: false, off_reason: "reverted" });
    expect(orig?.id).toBeTruthy();
  });

  it("soát B1: bản gốc và bản sao không cùng Bật qua PATCH, bản chưa xuất bản không PATCH bật được", async () => {
    const code = (j: Json) => j.error?.code ?? j.code;
    let l = await call("A", "GET", P(X));
    const orig = rowOf(l.json, lib);
    const copy = (l.json.items as Json[]).find(
      (x) => x.kind === "company" && x.source?.flow_key === "e1b-duyet",
    );
    // sau revert: gốc Bật, bản sao Tắt ⇒ bật bản sao bằng PATCH bị chặn
    const a = await call("A", "PATCH", `${P(X)}/${copy?.id}`, { enabled: true });
    expect([a.status, code(a.json)]).toEqual([409, "FLOW_PAIR_ACTIVE"]);
    // xuất bản bản sao (gốc Tắt) rồi PATCH bật lại gốc ⇒ chặn
    await call("A", "POST", `${P(X)}/${copy?.id}/publish`);
    const b = await call("A", "PATCH", `${P(X)}/${orig?.id}`, { enabled: true });
    expect([b.status, code(b.json)]).toEqual([409, "FLOW_PAIR_ACTIVE"]);
    l = await call("A", "GET", P(X));
    expect([rowOf(l.json, lib)?.enabled, rowOf(l.json, copy?.flow_id)?.enabled]).toEqual([
      false,
      true,
    ]);
    // bản sao mới (chưa xuất bản) của flow có điều kiện ⇒ PATCH bật bị chặn, phải qua Xuất bản
    const condRow = rowOf(l.json, libCond);
    const c = await call("A", "POST", `${P(X)}/${condRow?.id}/clone`);
    const n = await call("A", "PATCH", `${P(X)}/${c.json.id}`, { enabled: true });
    expect([n.status, code(n.json)]).toEqual([409, "FLOW_NOT_PUBLISHED"]);
    await call("A", "POST", `${P(X)}/${copy?.id}/revert`); // trả trạng thái cho ca sau
  });

  it("xếp thứ tự: đủ id ⇒ position theo mảng, thiếu/lạ ⇒ 422", async () => {
    const l = await call("A", "GET", P(X));
    const ids = (l.json.items as Json[]).map((x) => x.id).reverse();
    const r = await call("A", "PUT", `${P(X)}/order`, { ids });
    expect(r.status).toBe(200);
    expect((r.json.items as Json[]).map((x) => x.id)).toEqual(ids);
    const bad = await call("A", "PUT", `${P(X)}/order`, { ids: ids.slice(1) });
    expect(bad.status).toBe(422);
  });
});
