// ADM-BR-09 · M4-AC12 · AC-A09 · quyền chéo các endpoint M4 khối A + B (test-plan F1–F3). Xanh ở T6.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createM4Env, expectErr4, ID4, type M4Env, resetNow, TENANT_ID } from "./_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

const ROUTES: Array<[string, string, unknown?]> = [
  ["GET", `/admin/tenants/${A}/quotas`],
  ["PUT", `/admin/tenants/${A}/quotas`, { version: 1, items: [] }],
  ["GET", "/admin/quota-banner"],
  ["GET", "/admin/usage"],
  ["GET", "/admin/usage.csv"],
  ["GET", "/admin/overview"],
  ["GET", "/admin/audit"],
  ["GET", `/admin/audit/${ID4.unknown}`],
  ["POST", `/admin/audit/${ID4.unknown}/restore`, {}],
];

describe("ADM-BR-09 · M4-AC12 · quyền", () => {
  it("ADM-BR-09 · M4-AC12 · F1 · an (member) → 403 cho mọi endpoint quota/usage/overview/audit/restore", async () => {
    const an = env.by("acme", "an");
    for (const [m, p, b] of ROUTES) {
      const r = await an(m, p, b);
      expect([m, p, r.status]).toEqual([m, p, 403]);
      expectErr4(r, "FORBIDDEN");
    }
  });

  it("ADM-BR-09 · AC-A09 · F2 · binh → 403 PUT quotas, restore; 404 quotas/usage/usage.csv/audit của globex", async () => {
    const binh = env.by("acme", "binh");
    expectErr4(
      await binh("PUT", `/admin/tenants/${A}/quotas`, { version: 1, items: [] }),
      "FORBIDDEN",
    );
    expectErr4(await binh("POST", `/admin/audit/${ID4.unknown}/restore`, {}), "FORBIDDEN");
    for (const p of [
      `/admin/tenants/${G}/quotas`,
      `/admin/usage?tenant_id=${G}`,
      `/admin/usage.csv?tenant_id=${G}`,
      `/admin/audit?tenant_id=${G}`,
    ]) {
      const r = await binh("GET", p);
      expect([p, r.status]).toEqual([p, 404]);
      expectErr4(r, "NOT_FOUND");
    }
  });

  it("ADM-BR-09 · F3 · không token → 401", async () => {
    for (const [m, p, b] of ROUTES) {
      const r = await env.call(m, p, { body: b });
      expect([m, p, r.status]).toEqual([m, p, 401]);
      expectErr4(r, "UNAUTHORIZED");
    }
  });
});
