// ADM-BR-14, ADM-NFR-07 · chỉ platform_admin được dùng 25 route /admin/{secrets,workflows,commands,features}*
// (test-plan X; M2-AC01; M2-R06). Role kiểm TRƯỚC khi parse body và tra thực thể.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ALL_CATALOG, ID } from "./_data";
import {
  createM2Env,
  expectErr,
  type M2Env,
  type Res,
  signJwtFor,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

let env: M2Env;
beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset(ALL_CATALOG);
});

type Ids = { secret: string; wf: string; cmd: string; feat: string; tenant: string };
type Route = { name: string; method: string; build: (i: Ids) => { path: string; body?: unknown } };
const REAL: Ids = {
  secret: "DIFY_OLD_KEY",
  wf: ID.workflow.reportTax,
  cmd: ID.command.dich,
  feat: ID.feature.keToan,
  tenant: TENANT_ID.acme,
};
const UNKNOWN: Ids = {
  secret: "DIFY_KHONG_CO",
  wf: ID.unknown,
  cmd: ID.unknown,
  feat: ID.unknown,
  tenant: ID.unknown,
};
const ABC: Ids = { secret: "abc", wf: "abc", cmd: "abc", feat: "abc", tenant: "abc" };

const cmdBody = {
  name: "moi-cmd",
  description: { vi: "Mô tả" },
  workflow_id: ID.workflow.reportTax,
  output: { field: "text", render: "text" },
};
const wfBody = {
  key: "moi-wf",
  name: "Moi",
  description: "d".repeat(30),
  app_type: "workflow",
  base_url: "https://x.example.com",
  secret_id: ID.secret.old,
};
const r = (name: string, method: string, build: Route["build"]): Route => ({ name, method, build });
const ROUTES: Route[] = [
  r("GET /admin/secrets", "GET", () => ({ path: "/admin/secrets" })),
  r("POST /admin/secrets", "POST", () => ({
    path: "/admin/secrets",
    body: { name: "DIFY_MOI", value: "12345678" },
  })),
  r("PUT /admin/secrets/:name", "PUT", (i) => ({
    path: `/admin/secrets/${i.secret}`,
    body: { value: "12345678" },
  })),
  r("PATCH /admin/secrets/:name", "PATCH", (i) => ({
    path: `/admin/secrets/${i.secret}`,
    body: { note: "x" },
  })),
  r("DELETE /admin/secrets/:name", "DELETE", (i) => ({ path: `/admin/secrets/${i.secret}` })),
  r("GET /admin/workflows", "GET", () => ({ path: "/admin/workflows" })),
  r("POST /admin/workflows", "POST", () => ({ path: "/admin/workflows", body: wfBody })),
  r("GET /admin/workflows/:id", "GET", (i) => ({ path: `/admin/workflows/${i.wf}` })),
  r("GET /admin/workflows/:id/usages", "GET", (i) => ({ path: `/admin/workflows/${i.wf}/usages` })),
  r("PATCH /admin/workflows/:id", "PATCH", (i) => ({
    path: `/admin/workflows/${i.wf}`,
    body: { version: 1, name: "Moi 2" },
  })),
  r("DELETE /admin/workflows/:id", "DELETE", (i) => ({ path: `/admin/workflows/${i.wf}` })),
  r("GET /admin/commands", "GET", () => ({ path: "/admin/commands" })),
  r("POST /admin/commands", "POST", () => ({ path: "/admin/commands", body: cmdBody })),
  r("GET /admin/commands/:id", "GET", (i) => ({ path: `/admin/commands/${i.cmd}` })),
  r("PATCH /admin/commands/:id", "PATCH", (i) => ({
    path: `/admin/commands/${i.cmd}`,
    body: { version: 1, description: { vi: "Khác" } },
  })),
  r("DELETE /admin/commands/:id", "DELETE", (i) => ({ path: `/admin/commands/${i.cmd}` })),
  r("GET /admin/commands/:id/access", "GET", (i) => ({ path: `/admin/commands/${i.cmd}/access` })),
  r("GET /admin/features", "GET", () => ({ path: "/admin/features" })),
  r("POST /admin/features", "POST", () => ({
    path: "/admin/features",
    body: { key: "moi-ft", name: { vi: "Mới" } },
  })),
  r("GET /admin/features/:id", "GET", (i) => ({ path: `/admin/features/${i.feat}` })),
  r("PATCH /admin/features/:id", "PATCH", (i) => ({
    path: `/admin/features/${i.feat}`,
    body: { version: 1, name: { vi: "Khác" } },
  })),
  r("DELETE /admin/features/:id", "DELETE", (i) => ({ path: `/admin/features/${i.feat}` })),
  r("GET /admin/features/:id/entitlements", "GET", (i) => ({
    path: `/admin/features/${i.feat}/entitlements`,
  })),
  r("PUT /admin/features/:id/entitlements/:tenant_id", "PUT", (i) => ({
    path: `/admin/features/${i.feat}/entitlements/${i.tenant}`,
  })),
  r("DELETE /admin/features/:id/entitlements/:tenant_id", "DELETE", (i) => ({
    path: `/admin/features/${i.feat}/entitlements/${i.tenant}`,
  })),
];

/** Hash toàn bộ dữ liệu danh mục: so trước/sau để chắc chắn không có ghi nào lọt qua. */
async function snapshot(): Promise<string> {
  const parts: string[] = [];
  for (const t of [
    "secrets",
    "workflows",
    "commands",
    "command_names",
    "features",
    "feature_commands",
    "feature_entitlements",
  ]) {
    const rows = await env.owner.unsafe(
      `select coalesce(md5(string_agg(row_to_json(x)::text, '|' order by row_to_json(x)::text)), '') as h from admin.${t} x`,
    );
    parts.push(String((rows[0] as unknown as { h: string }).h));
  }
  return parts.join(":");
}

const call = (route: Route, ids: Ids, token?: string): Promise<Res> => {
  const { path, body } = route.build(ids);
  return env.call(route.method, path, { token, body });
};

describe("ADM-BR-14 · M2-AC01 · 25 route chỉ dành cho platform_admin", () => {
  for (const route of ROUTES) {
    it(`ADM-BR-14 · M2-AC01 · ${route.name}: không Bearer → 401; member → 403; tenant_admin → 403 (body hợp lệ, body sai, id lạ, id abc) và DB không đổi`, async () => {
      const before = await snapshot();
      expectErr(await call(route, REAL), "UNAUTHORIZED");
      const member = await env.token("acme", "an");
      expectErr(await call(route, REAL, member), "FORBIDDEN");
      const tenantAdmin = await env.token("acme", "binh");
      const texts = new Set<string>();
      for (const ids of [REAL, UNKNOWN, ABC]) {
        const res = await call(route, ids, tenantAdmin);
        expectErr(res, "FORBIDDEN");
        texts.add(res.text);
      }
      if (route.build(REAL).body !== undefined) {
        const { path } = route.build(REAL);
        const bad = await env.call(route.method, path, {
          token: tenantAdmin,
          body: { garbage: true },
        });
        expectErr(bad, "FORBIDDEN");
        texts.add(bad.text);
        const raw = await env.call(route.method, path, {
          token: tenantAdmin,
          raw: "{không phải json",
        });
        expectErr(raw, "FORBIDDEN");
        texts.add(raw.text);
      }
      expect(texts.size).toBe(1);
      expect(await snapshot()).toBe(before);
    });
  }

  it("ADM-BR-14 · M2-AC01 · tenant_admin của tenant bị khoá → 401 UNAUTHORIZED, body không chứa tên secret nào", async () => {
    const token = await env.token("acme", "binh");
    await env.owner`update admin.tenants set active = false where id = ${TENANT_ID.acme}`;
    const res = await env.call("GET", "/admin/secrets", { token });
    expectErr(res, "UNAUTHORIZED");
    expect(res.text).not.toContain("DIFY_");
  });

  it("ADM-BR-14 · ADM-NFR-07 · token ký đúng nhưng claim role platform_admin của member / tenant_admin (DB đọc lại mỗi request) → 403", async () => {
    for (const sub of [USER_ID.an, USER_ID.binh]) {
      const forged = await signJwtFor(env, sub, { tid: TENANT_ID.acme, role: "platform_admin" });
      expectErr(await env.call("GET", "/admin/secrets", { token: forged }), "FORBIDDEN");
      expectErr(await env.call("GET", "/admin/features", { token: forged }), "FORBIDDEN");
    }
  });

  it("ADM-BR-14 · M2-R06 · platform_admin bị khoá giữa hai request → request sau 401, không lộ dữ liệu", async () => {
    const t = await env.token("platform", "admin2");
    expect((await env.call("GET", "/admin/secrets", { token: t })).status).toBe(200);
    await env.owner`update admin.users set active = false where id = ${USER_ID.admin2}`;
    expectErr(await env.call("GET", "/admin/secrets", { token: t }), "UNAUTHORIZED");
  });

  it("ADM-BR-14 · M2-R06 · platform_admin không bị 403 ở mọi nhóm route (đại diện mỗi nhóm trả 200)", async () => {
    const t = await env.admin();
    for (const p of ["/admin/secrets", "/admin/workflows", "/admin/commands", "/admin/features"]) {
      const res = await env.call("GET", p, { token: t });
      expect(res.status).toBe(200);
      expect(res.json).toHaveProperty("items");
    }
  });
});
