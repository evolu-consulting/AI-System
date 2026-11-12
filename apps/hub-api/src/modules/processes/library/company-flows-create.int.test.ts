// CR-127 · E8 · BR-10/11 · M1 · int (Hono thật + DB thật): quản trị công ty 403 `FORBIDDEN_TENANT_ADMIN_WRITE` ở MỌI route ghi (đọc vẫn
// 200); quản trị nền tảng tạo trống / từ mẫu; phòng khớp theo mã rồi theo tên, không khớp ⇒ `issues`; chặn chéo công ty.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { companyFlowsRoutes } from "./company-flows.routes";

const X = tenantId(1271);
const Y = tenantId(1272);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1270), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1271), tenantId: X, role: "tenant_admin" },
  M: { userId: userId(1272), tenantId: X, role: "member" },
  AY: { userId: userId(1273), tenantId: Y, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let tpl = "";
const P = (t: string) => `/tenants/${t}/company-flows`;

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const review = (key: string, group: string) => ({
  key,
  name: key,
  step: 0,
  executor: { kind: "set", values: [] },
  after: { kind: "review", group_key: group },
  real_action: false,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1271', 'X'), (${Y}, 't1272', 'Y')`;
  await users(o, X, 3, { from: 1270 });
  await users(o, Y, 1, { from: 1273 });
  await o`insert into admin.groups (tenant_id, key, name) values
    (${X}, 'p-kd', '{"vi":"Kinh Doanh"}'::jsonb), (${X}, 'ke-toan', '{"vi":"Kế toán"}'::jsonb)`;
  const st = JSON.stringify([
    review("b1", "kinh-doanh"), // khớp theo TÊN
    review("b2", "ke-toan"), // khớp theo MÃ
    review("b3", "phap-che"), // không khớp
    {
      key: "xong",
      name: "Xong",
      step: 3,
      outcome: "approved",
      executor: { kind: "set", values: [] },
    },
  ]);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version)
    values (null, 'e8-mau', 'Mẫu E8', ${st}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts', 1) returning id::text as id`;
  tpl = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${tpl}, 1, 'Mẫu E8', ${st}::text::jsonb)`;
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

describe("CR-127 E8 · quyền soạn + tạo quy trình", () => {
  it("quản trị công ty: GET 200; mọi route ghi 403 FORBIDDEN_TENANT_ADMIN_WRITE (kể cả id lạ, trước parse); member 403; công ty khác 403", async () => {
    expect((await call("A", "GET", P(X))).status).toBe(200);
    const id = "00000000-0000-4000-8000-000000000001";
    const writes: [string, string, unknown][] = [
      ["POST", P(X), { flow_id: tpl }],
      ["POST", P(X), "khong-phai-json-hop-le"],
      ["POST", `${P(X)}/apply`, { flow_id: tpl }],
      ["PUT", `${P(X)}/order`, { ids: [id] }],
      ["PATCH", `${P(X)}/${id}`, { enabled: false }],
      ["POST", `${P(X)}/${id}/publish`, undefined],
    ];
    for (const [m, p, b] of writes) {
      const r = await call("A", m, p, b);
      expect([m, p, r.status, r.json.error?.code]).toEqual([
        m,
        p,
        403,
        "FORBIDDEN_TENANT_ADMIN_WRITE",
      ]);
    }
    const ay = await call("AY", "POST", P(X), { name: "x", app: "contracts", from: "blank" });
    expect([ay.status, ay.json.error?.code]).toEqual([403, "FORBIDDEN_TENANT_ADMIN_WRITE"]);
    expect((await call("M", "POST", P(X), { flow_id: tpl })).status).toBe(403);
    expect((await call("AY", "GET", P(X))).status).toBe(404);
  });

  it("platform tạo trống: cần app hợp lệ; công ty khác không bị đụng; công ty lạ 404", async () => {
    const bad = await call("P", "POST", P(X), { name: "Trống", from: "blank" });
    expect([bad.status, bad.json.error?.code]).toEqual([422, "FLOW_APP_REQUIRED"]);
    const unk = await call("P", "POST", P(X), { name: "Trống", app: "khong-co", from: "blank" });
    expect([unk.status, unk.json.error?.code]).toEqual([422, "FLOW_APP_UNKNOWN"]);
    const ok = await call("P", "POST", P(X), {
      name: "Quy trình mới",
      app: "contracts",
      from: "blank",
    });
    expect(ok.status).toBe(201);
    const [d] = await o<
      { tenant_id: string; key: string; name: string }[]
    >`select tenant_id::text as tenant_id, key, name from hub.process_defs where id = ${ok.json.flow_id}`;
    expect(d).toMatchObject({ tenant_id: X, key: "quy-trinh-moi", name: "Quy trình mới" });
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.process_defs where tenant_id = ${Y}`;
    expect(n?.n).toBe(0);
    const lost = await call("P", "POST", P("00000000-0000-4000-8000-0000000000ff"), {
      name: "x",
      app: "contracts",
      from: "blank",
    });
    expect(lost.status).toBe(404);
  });
});
