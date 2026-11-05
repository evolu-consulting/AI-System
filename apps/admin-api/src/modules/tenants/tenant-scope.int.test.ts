// CR-112 · ADM-FR-81 · ma trận quyền workspace công ty `/admin/tenants/:id*` qua HTTP thật (app + DB).
// tenant_admin: tenant mình ⇒ đọc chi tiết/quota (rút gọn); route chỉ-platform ⇒ 403; tenant khác ⇒ 404 MỌI route.
// member ⇒ 403; đối tác ⇒ 403; platform_admin không đổi.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ExternalOrgSchema } from "@ai/contracts/external-orgs";
import { UserCreateResponseSchema } from "@ai/contracts/users";
import {
  createEnv,
  type Env,
  PW,
  TENANT_ID,
  USER_ID,
} from "../../../../../tests/acceptance/M1/_fixtures";

const OWN = TENANT_ID.acme;
const OTHER = TENANT_ID.globex;

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(() => env.reset());

/** [method, đường dẫn con] — tenant_admin được phép trên tenant mình. */
const ALLOWED: [string, string][] = [
  ["GET", ""],
  ["GET", "/quotas"],
  ["GET", "/profile"], // CR-121
];
/** Chỉ platform_admin (tenant_admin tenant mình ⇒ 403). */
const PLATFORM_ONLY: [string, string][] = [
  ["PATCH", ""],
  ["PATCH", "/profile"], // CR-121
  ["POST", "/lock"],
  ["POST", "/unlock"],
  ["PUT", "/quotas"],
  ["GET", "/daily-limits"],
  ["PUT", "/daily-limits"],
  ["POST", "/daily-limits/uploads/reset"],
  ["GET", "/packs"],
  ["PUT", "/packs/contracts"],
  ["DELETE", "/packs/contracts"],
  ["GET", "/default-app"],
  ["PUT", "/default-app"],
  ["GET", "/workflow-tools"],
];
const ALL = [...ALLOWED, ...PLATFORM_ONLY];

const hit = (token: string, m: string, tid: string, sub: string) =>
  env.call(m, `/admin/tenants/${tid}${sub}`, { token, body: m === "GET" ? undefined : {} });

async function statuses(token: string, tid: string, routes: [string, string][]) {
  const out: Record<string, number> = {};
  for (const [m, sub] of routes) out[`${m} ${sub}`] = (await hit(token, m, tid, sub)).status;
  return out;
}
const all = (routes: [string, string][], status: number) =>
  Object.fromEntries(routes.map(([m, sub]) => [`${m} ${sub}`, status]));

describe("CR-112 · ADM-FR-81 · phạm vi workspace công ty", () => {
  it("tenant_admin: tenant mình đọc được chi tiết + quota rút gọn, route chỉ-platform ⇒ 403", async () => {
    const t = await env.token("acme", "binh");
    const d = await hit(t, "GET", OWN, "");
    expect(d.status).toBe(200);
    expect(d.json.id).toBe(OWN);
    const q = await hit(t, "GET", OWN, "/quotas");
    expect(q.status).toBe(200);
    for (const row of q.json.items) expect(row.max_usd).toBeUndefined();
    expect(await statuses(t, OWN, PLATFORM_ONLY)).toEqual(all(PLATFORM_ONLY, 403));
    // Danh sách / tạo công ty vẫn chỉ platform.
    expect((await env.get("/admin/tenants", { token: t })).status).toBe(403);
    expect((await env.post("/admin/tenants", { token: t, body: {} })).status).toBe(403);
  });

  it("tenant_admin: tenant khác ⇒ 404 MỌI route (cả route chỉ-platform), id không tồn tại cũng 404", async () => {
    const t = await env.token("acme", "binh");
    expect(await statuses(t, OTHER, ALL)).toEqual(all(ALL, 404));
    expect((await hit(t, "GET", "01900000-0000-7000-8000-000000000999", "")).status).toBe(404);
  });

  it("tenant_admin: Người dùng/nhóm trong công ty mình; user công ty khác ⇒ 404", async () => {
    const t = await env.token("acme", "binh");
    expect((await env.get("/admin/users", { token: t })).status).toBe(200);
    expect((await env.get("/admin/groups", { token: t })).status).toBe(200);
    expect((await env.get(`/admin/users/${USER_ID.hoa}`, { token: t })).status).toBe(404);
  });

  it("member ⇒ 403 cả tenant mình lẫn tenant khác", async () => {
    const t = await env.token("acme", "an");
    expect(await statuses(t, OWN, ALL)).toEqual(all(ALL, 403));
    expect(await statuses(t, OTHER, ALLOWED)).toEqual(all(ALLOWED, 403));
  });

  it("platform_admin: mọi tenant như cũ (chi tiết + quota đủ tiền)", async () => {
    const t = await env.token("platform", "admin");
    for (const tid of [OWN, OTHER]) {
      expect((await hit(t, "GET", tid, "")).status).toBe(200);
      expect((await hit(t, "GET", tid, "/quotas")).status).toBe(200);
      expect((await hit(t, "GET", tid, "/daily-limits")).status).toBe(200); // DB test chỉ Admin: không có packs.*
    }
    expect((await env.get("/admin/tenants", { token: t })).status).toBe(200);
  });

  it("đối tác (user ngoài) ⇒ 403 trên workspace công ty", async () => {
    const binh = await env.token("acme", "binh");
    const o = await env.post("/admin/external-orgs", { token: binh, body: { name: "Cty NCC" } });
    const org = ExternalOrgSchema.parse(o.json).id;
    const u = await env.post(`/admin/external-orgs/${org}/users`, {
      token: binh,
      body: { username: "ncc9", display_name: "Đối tác 9" },
    });
    const { user } = UserCreateResponseSchema.parse(u.json);
    await env.owner`update admin.users set password_hash = ${env.hashes.pw}, must_change_password = false where id = ${user.id}`;
    const t = (await env.session("acme", "ncc9", PW)).token;
    try {
      expect(await statuses(t, OWN, ALLOWED)).toEqual(all(ALLOWED, 403));
      expect(await statuses(t, OTHER, ALLOWED)).toEqual(all(ALLOWED, 403));
    } finally {
      await env.owner`delete from admin.users where id = ${user.id}`;
      await env.owner`delete from admin.external_orgs where id = ${org}`;
    }
  });
});
