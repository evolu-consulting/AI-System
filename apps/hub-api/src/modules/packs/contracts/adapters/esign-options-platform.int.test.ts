// CR-127 · EO1 · `GET /esign/options?tenant_id=` cho platform_admin soạn quy trình của công ty (DB thật, pool hub_api): gói bật cho công ty
// đích ⇒ options của ĐÍCH (RLS tenant đích); đích chưa bật gói ⇒ 403 PACK_DISABLED; người không phải platform_admin gửi tenant_id khác
// ⇒ bị bỏ qua (vẫn thấy dữ liệu của chính công ty mình, không lộ chéo).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { packFeatureKey } from "@ai/contracts/packs";
import { createDb, type Db } from "@ai/db";
import { groups, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import type { ESignFiles } from "../application/esign.ports";
import { esignModule } from "../esign.mount";
import { esignRoutes } from "./esign.routes";
import { selfsignProvider } from "./esign.selfsign";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let T3 = ""; // chưa bật gói
let P = ""; // tenant của tài khoản platform
let UA = ""; // user T1
let UB = ""; // user T2
let UP = ""; // platform_admin
let G1 = "";
let G2 = "";

const files: ESignFiles = () => ({
  getContent: async () => new Uint8Array(),
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1, T2, T3, P] = (await tenants(o, 4, 981)) as [string, string, string, string];
  [UA] = (await users(o, T1, 1, { from: 981 })) as [string];
  [UB] = (await users(o, T2, 1, { from: 991 })) as [string];
  [UP] = (await users(o, P, 1, { from: 995 })) as [string];
  G1 = (await groups(o, T1, ["eo1-t1"])).get("eo1-t1") as string;
  G2 = (await groups(o, T2, ["eo1-t2"])).get("eo1-t2") as string;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

// Cổng quyền giả: T1, T2 có entitlement `contracts-read` (mọi user được cấp), T3/P thì không.
const view = (): PackAccessView => {
  const f = { id: "f-r", key: packFeatureKey("contracts", "read"), status: "on" };
  const ents = [T1, T2];
  const tenantOf = new Map([
    [UA, T1],
    [UB, T2],
    [UP, P],
  ]);
  return {
    catalog: async () => ({
      features: [f],
      entitled: new Set(ents.map((t) => `${t}:f-r`)),
      grantGroups: new Map(ents.map((t) => [`${t}:f-r`, ["g-all"]])),
    }),
    user: async (id) => ({ tenantId: tenantOf.get(id) as string, groupIds: new Set(["g-all"]) }),
  };
};

const get = async (user: AuthUser, qs: string) => {
  const u = esignModule(db, { esign: { providers: [selfsignProvider()] }, files });
  const app = new Hono<PackGuardVars>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", esignRoutes(view(), u));
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  const res = await app.request(`/esign/options${qs}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const post = async (user: AuthUser, qs: string) => {
  const u = esignModule(db, { esign: { providers: [selfsignProvider()] }, files });
  const app = new Hono<PackGuardVars>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", esignRoutes(view(), u));
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  const res = await app.request(`/esign/node-config/check${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const as = (userId: string, tenantId: string, role: string): AuthUser =>
  ({ userId, tenantId, role }) as unknown as AuthUser;
const gids = (j: Record<string, unknown>) => (j.groups as { id: string }[]).map((g) => g.id);

describe("EO1 · /esign/options?tenant_id=", () => {
  it("platform_admin + tenant_id đích đã bật gói ⇒ 200, options của công ty đích", async () => {
    const r = await get(as(UP, P, "platform_admin"), `?tenant_id=${T1}`);
    expect(r.status).toBe(200);
    expect(gids(r.json)).toContain(G1);
    expect(gids(r.json)).not.toContain(G2);
    const r2 = await get(as(UP, P, "platform_admin"), `?tenant_id=${T2}`);
    expect(gids(r2.json)).toContain(G2);
    expect(gids(r2.json)).not.toContain(G1);
  });

  it("user thường gửi tenant_id công ty khác ⇒ bỏ qua, vẫn chỉ thấy công ty mình", async () => {
    const r = await get(as(UB, T2, "member"), `?tenant_id=${T1}`);
    expect(r.status).toBe(200);
    expect(gids(r.json)).toContain(G2);
    expect(gids(r.json)).not.toContain(G1);
  });

  it("đích chưa bật gói ⇒ 403 PACK_DISABLED; thiếu tenant_id ⇒ 400", async () => {
    const r = await get(as(UP, P, "platform_admin"), `?tenant_id=${T3}`);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).toContain("PACK_DISABLED");
    expect((await get(as(UP, P, "platform_admin"), "")).status).toBe(400);
  });

  it("EO2 · node-config/check: platform_admin + tenant_id ⇒ 200; đích chưa bật gói ⇒ 403", async () => {
    const r = await post(as(UP, P, "platform_admin"), `?tenant_id=${T1}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.issues)).toBe(true);
    const r3 = await post(as(UP, P, "platform_admin"), `?tenant_id=${T3}`);
    expect(r3.status).toBe(403);
  });
});
