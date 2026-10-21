// tenant-admin-scope (người dùng chốt 2026-10-21) · tenant_admin thấy bản RÚT GỌN của Chi phí & quota và Nhật ký,
// chỉ tenant mình; platform_admin thấy đủ. Chặn ở server (không chỉ ẩn UI): không tiền, không phân tích chi tiết/bản ghi
// thô/CSV/run, không trường kỹ thuật audit, không sự kiện hệ thống/nền tảng.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  createM4Env,
  expectErr4,
  ID4,
  insertUsage,
  type M4Env,
  parse4,
  resetNow,
  setQuota,
  TENANT_ID,
} from "../M4/_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
const MONEY = ["cost_usd", "margin_usd", "billable_usd", "unpriced_rows", "overage", "max_usd"];

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

const binh = (m: string, p: string) => env.by("acme", "binh")(m, p);
const admin = (p: string) => env.by("platform", "admin")("GET", p);
const noMoney = (text: string) => {
  for (const k of MONEY) expect([k, text.includes(k)]).toEqual([k, false]);
};

describe("Chi phí & quota · tenant_admin", () => {
  it("usage + quota + overview: không trường tiền; platform vẫn đủ; lượt/token/% giữ nguyên", async () => {
    await setQuota(env.owner, A, null, { runs: 1000, usd: "50" });
    await insertUsage(env.owner, 3, { tenant: A, runFrom: 0 });
    await insertUsage(env.owner, 2, { tenant: G, runFrom: 10 });
    const u = await binh("GET", "/admin/usage");
    expect(u.status).toBe(200);
    noMoney(u.text);
    expect(parse4("UsageReportTenantSchema", u.json).kpi.runs).toBe(3);
    expect(u.json.quotas[0]).toMatchObject({ feature_id: null, max_runs: 1000 });
    const q = await binh("GET", `/admin/tenants/${A}/quotas`);
    expect(q.status).toBe(200);
    noMoney(q.text);
    const o = await binh("GET", "/admin/overview");
    expect(o.status).toBe(200);
    noMoney(o.text);
    const full = await admin("/admin/usage?tenant_id=" + A);
    expect(full.text).toContain("cost_usd");
    expect(full.text).toContain("billable_usd");
  });

  it("analytics / records / csv / run → 403 cho tenant_admin, 200 cho platform; chéo tenant bị chặn", async () => {
    for (const p of [
      "/admin/usage/analytics",
      "/admin/usage/records",
      "/admin/usage/records.csv",
      "/admin/usage.csv",
      `/admin/usage/runs/${ID4.unknown}`,
      `/admin/usage/analytics?tenant_id=${G}`,
    ])
      expectErr4(await binh("GET", p), "FORBIDDEN");
    // M4 env không có hub.usage_daily_dim ⇒ platform có thể 500 ở DB, nhưng không bao giờ 403 (guard).
    expect((await admin("/admin/usage/analytics")).status).not.toBe(403);
    expectErr4(await binh("GET", `/admin/usage?tenant_id=${G}`), "NOT_FOUND");
    expectErr4(await binh("GET", `/admin/tenants/${G}/quotas`), "NOT_FOUND");
  });
});

describe("Nhật ký · tenant_admin", () => {
  const tag = () => `tas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  async function seed(P: string) {
    const o = env.owner;
    const sum = o.json({ subject_name: "x", added: ["a"], file: "tech.csv", restored_version: 3 });
    const row = (t: string | null, ent: string, name: string) =>
      o`insert into admin.audit_log (tenant_id, action, entity, entity_name, summary, before, after, entity_version)
        values (${t}, 'update', ${ent}, ${`${P}${name}`}, ${sum}, ${o.json({ secret: "v1" })}, ${o.json({ secret: "v2" })}, 4)`;
    await row(A, "user", "u-acme");
    await row(A, "group", "g-acme");
    await row(A, "command", "cmd-acme");
    await row(A, "secret", "sec-acme");
    await row(A, "quota", "q-acme");
    await row(G, "user", "u-globex");
    await row(null, "user", "u-system");
  }
  const names = (r: { json: { items: { entity_name: string }[] } }) =>
    r.json.items.map((i) => i.entity_name).sort();

  it("chỉ sự kiện nghiệp vụ tenant mình; không before/after/phiên bản/file; platform thấy đủ", async () => {
    const P = tag();
    await seed(P);
    const r = await binh("GET", `/admin/audit?q=${P}`);
    expect(r.status).toBe(200);
    expect(names(r)).toEqual([`${P}g-acme`, `${P}u-acme`]);
    const item = r.json.items.find((i: { entity: string }) => i.entity === "user");
    parse4("AuditItemSchema", item);
    expect(item).toMatchObject({
      tenant_key: null,
      config_version: null,
      entity_version: null,
      restorable: false,
      summary: { subject_name: "x", added: ["a"] },
    });
    expect(item.summary.file).toBeUndefined();
    expect(item.summary.restored_version).toBeUndefined();
    const d = await binh("GET", `/admin/audit/${item.id}`);
    expect(d.status).toBe(200);
    expect([d.json.before, d.json.after]).toEqual([null, null]);
    // lọc entity nền tảng → rỗng; xem dòng nền tảng / globex / hệ thống → 404
    expect((await binh("GET", `/admin/audit?q=${P}&entity=command`)).json.items).toEqual([]);
    const [{ id: cmd }] =
      await env.owner`select id from admin.audit_log where entity_name = ${`${P}cmd-acme`}`;
    expectErr4(await binh("GET", `/admin/audit/${cmd}`), "NOT_FOUND");
    expectErr4(await binh("GET", `/admin/audit?tenant_id=${G}`), "NOT_FOUND");
    expectErr4(await binh("GET", "/admin/audit?tenant_id=system"), "NOT_FOUND");
    // platform: đủ 7 dòng + payload
    const all = await admin(`/admin/audit?q=${P}`);
    expect(names(all)).toHaveLength(7);
    const uid = all.json.items.find((i: { entity_name: string }) => i.entity_name === `${P}u-acme`);
    const full = await admin(`/admin/audit/${uid.id}`);
    expect([full.json.before, full.json.after]).toEqual([{ secret: "v1" }, { secret: "v2" }]);
    expect(full.json.summary.file).toBe("tech.csv");
  });

  it("overview.recent_changes của tenant_admin cùng bộ lọc nghiệp vụ", async () => {
    const P = tag();
    await seed(P);
    const o = await binh("GET", "/admin/overview");
    const ents = o.json.recent_changes.map((c: { entity: string }) => c.entity);
    expect(ents.length).toBeGreaterThan(0);
    for (const e of ents) expect(["user", "group", "grant", "entitlement"]).toContain(e);
    expect(o.json.recent_changes.every((c: { tenant_id: string }) => c.tenant_id === A)).toBe(true);
  });
});
