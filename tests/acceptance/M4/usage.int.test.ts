// ADM-FR-42 · M4-R01, R03, R07–R09 · BR-09 · GET /admin/usage (test-plan U1–U9; M4-AC03, M4-AC13, AC-A09, AC-A12).
// Dữ liệu U (beforeEach): acme tháng này r0 ke-toan, r1 ke-toan overage, r2 ke-toan 2 hàng, r3 feature NULL billable NULL;
// globex r10, r11; acme tháng trước r20–r23. Khoảng truy vấn = trọn tháng VN hiện tại (để `previous` chắc chứa giữa
// tháng trước). Xanh ở T5.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  createM4Env,
  expectErr4,
  ID,
  ID4,
  inPrevMonth,
  insertUsage,
  type M4Env,
  parse4,
  resetNow,
  setQuota,
  TENANT_ID,
  vnDate,
  vnMonthStart,
} from "./_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
const KT = ID.feature.keToan;
const now = () => new Date();
const FROM = () => vnDate(vnMonthStart(now()));
const TO = () => vnDate(new Date(vnMonthStart(now(), 1).getTime() - 1000));
const DAYS = () =>
  Math.round((vnMonthStart(now(), 1).getTime() - vnMonthStart(now()).getTime()) / 86_400_000);
const range = () => `from=${FROM()}&to=${TO()}`;

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});

async function seedU(): Promise<void> {
  const o = env.owner;
  await insertUsage(o, 1, { tenant: A, feature: KT, runFrom: 0 });
  await insertUsage(o, 1, { tenant: A, feature: KT, runFrom: 1, overage: true });
  await insertUsage(o, 1, { tenant: A, feature: KT, runFrom: 2 });
  await insertUsage(o, 1, { tenant: A, feature: KT, runFrom: 2 });
  await insertUsage(o, 1, { tenant: A, runFrom: 3, billable: null });
  await insertUsage(o, 2, { tenant: G, feature: KT, runFrom: 10 });
  await insertUsage(o, 4, { tenant: A, runFrom: 20, at: inPrevMonth() });
}
const admin = (q: string) => env.as("GET", `/admin/usage?${q}`);
const binh = (q = "") => env.by("acme", "binh")("GET", `/admin/usage${q ? `?${q}` : ""}`);
const n = (v: unknown) => Number(v);

describe("ADM-FR-42 · báo cáo platform", () => {
  beforeEach(async () => {
    await resetNow(env);
    await seedU();
  });

  it("ADM-FR-42 · M4-R03 · AC-A12 · U1 · admin acme: runs đếm run_id khác nhau, tokens Σ, billable bỏ NULL, unpriced 1, overage 1, margin = billable − cost; previous.runs 4; has_data", async () => {
    const res = await admin(`tenant_id=${A}&${range()}`);
    expect(res.status).toBe(200);
    const b = parse4("UsageReportPlatformSchema", res.json);
    expect(b.tenant_id).toBe(A);
    expect(b.range).toEqual({ from: FROM(), to: TO() });
    expect(b.has_data).toBe(true);
    const k = b.kpi;
    expect([
      k.runs,
      k.tokens,
      k.input_tokens,
      k.output_tokens,
      k.unpriced_rows,
      k.overage_runs,
    ]).toEqual([4, 750, 500, 250, 1, 1]);
    expect([n(k.billable_usd), n(k.cost_usd), n(k.margin_usd)]).toEqual([0.4, 0.3, 0.1]);
    expect(b.previous.runs).toBe(4);
  });

  it("ADM-FR-42 · U2 · daily đủ mọi ngày (ngày trống 0); top_features giảm theo billable, có dòng feature null; overage đúng; quotas có khi chọn tenant", async () => {
    await setQuota(env.owner, A, null, { runs: 100 });
    const b = parse4("UsageReportPlatformSchema", (await admin(`tenant_id=${A}&${range()}`)).json);
    expect(b.daily).toHaveLength(DAYS());
    expect(b.daily.map((d: { date: string }) => d.date)[0]).toBe(FROM());
    expect(b.daily.reduce((s: number, d: { runs: number }) => s + d.runs, 0)).toBe(4);
    expect(b.daily.filter((d: { runs: number }) => d.runs === 0)).toHaveLength(DAYS() - 1);
    const tf = b.top_features as {
      feature_id: string | null;
      runs: number;
      billable_usd: string;
      overage: boolean;
    }[];
    expect(tf.map((f) => f.feature_id)).toEqual([KT, null]);
    expect(tf.map((f) => f.runs)).toEqual([3, 1]);
    expect(tf.map((f) => f.overage)).toEqual([true, false]);
    expect(n(tf[0]?.billable_usd)).toBe(0.4);
    expect(b.top_users.length).toBeLessThanOrEqual(10);
    expect(b.quotas[0]).toMatchObject({ feature_id: null, max_runs: 100, pct: 4 });
  });

  it("ADM-FR-42 · U4 · feature_id=none chỉ hàng NULL; feature_id=ke-toan chỉ ke-toan; admin không tenant_id → tenant_id null, tenants có acme+globex, quotas []", async () => {
    let b = parse4(
      "UsageReportPlatformSchema",
      (await admin(`tenant_id=${A}&feature_id=none&${range()}`)).json,
    );
    expect([b.feature_id, b.kpi.runs, b.kpi.unpriced_rows]).toEqual(["none", 1, 1]);
    b = parse4(
      "UsageReportPlatformSchema",
      (await admin(`tenant_id=${A}&feature_id=${KT}&${range()}`)).json,
    );
    expect([b.feature_id, b.kpi.runs]).toEqual([KT, 3]);
    b = parse4("UsageReportPlatformSchema", (await admin(range())).json);
    expect(b.tenant_id).toBeNull();
    expect(b.quotas).toEqual([]);
    expect(b.kpi.runs).toBe(6);
    const keys = (b.tenants as { tenant_key: string; runs: number }[]).map((t) => [
      t.tenant_key,
      t.runs,
    ]);
    expect(keys).toContainEqual(["acme", 4]);
    expect(keys).toContainEqual(["globex", 2]);
  });

  it('ADM-FR-42 · M4-R08 · ADM-BR-09 · M4-AC03 · U5 · binh không tenant_id → acme; chuỗi body không có cost_usd/margin_usd/"tenants"; strict Tenant; không lẫn globex', async () => {
    const res = await binh(range());
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("cost_usd");
    expect(res.text).not.toContain("margin_usd");
    expect(res.text).not.toContain('"tenants"');
    const b = parse4("UsageReportTenantSchema", res.json);
    expect(b.tenant_id).toBe(A);
    expect(b.kpi.runs).toBe(4);
    expect(n(b.kpi.billable_usd)).toBe(0.4);
  });

  it("ADM-BR-09 · AC-A09 · U6 · binh tenant_id=globex → 404; admin tenant_id không tồn tại → 404; an → 403", async () => {
    expectErr4(await binh(`tenant_id=${G}`), "NOT_FOUND");
    expectErr4(await admin(`tenant_id=${ID4.unknown}`), "NOT_FOUND");
    expectErr4(await env.by("acme", "an")("GET", "/admin/usage"), "FORBIDDEN");
  });

  it("ADM-FR-42 · U7 · from>to, 367 ngày, from=2026-13-01, feature_id=abc → 400 VALIDATION_ERROR", async () => {
    for (const q of [
      "from=2026-05-02&to=2026-05-01",
      "from=2025-01-01&to=2026-01-02",
      "from=2026-13-01&to=2026-13-02",
      "feature_id=abc",
      "tenant_id=abc",
    ]) {
      const r = await admin(q);
      expect([q, r.status]).toEqual([q, 400]);
      expectErr4(r, "VALIDATION_ERROR");
    }
  });

  it("ADM-FR-42 · M4-R03 · U9 · hàng run_id NULL: không vào runs/overage_runs/quota used.runs; có vào tokens, billable, cost, quota token/USD", async () => {
    await setQuota(env.owner, A, null, { runs: 100, tokens: 10_000, usd: "10.00" });
    const before = parse4(
      "UsageReportPlatformSchema",
      (await admin(`tenant_id=${A}&${range()}`)).json,
    );
    await env.owner`insert into hub.usage_logs (tenant_id, run_id, user_id, feature_id, billing, input_tokens,
      output_tokens, cost_usd, billable_usd, overage, at)
      values (${A}, null, null, null, 'api', 100, 50, '0.06', '0.10', true, ${new Date(Date.now() - 60_000)})`;
    const b = parse4("UsageReportPlatformSchema", (await admin(`tenant_id=${A}&${range()}`)).json);
    expect(b.kpi.runs).toBe(before.kpi.runs);
    expect(b.kpi.overage_runs).toBe(before.kpi.overage_runs);
    expect(b.kpi.tokens).toBe(before.kpi.tokens + 150);
    expect(n(b.kpi.billable_usd)).toBeCloseTo(n(before.kpi.billable_usd) + 0.1, 6);
    expect(n(b.kpi.cost_usd)).toBeCloseTo(n(before.kpi.cost_usd) + 0.06, 6);
    const q0 = before.quotas[0].used;
    const q1 = b.quotas[0].used;
    expect(q1.runs).toBe(q0.runs);
    expect(q1.tokens).toBe(q0.tokens + 150);
    expect(n(q1.billable_usd)).toBeCloseTo(n(q0.billable_usd) + 0.1, 6);
  });
});

describe("ADM-FR-42 · M4-R01 · R09 · biên", () => {
  beforeEach(async () => {
    await resetNow(env);
  });

  it("ADM-FR-42 · M4-R01 · U3 · hàng at = đầu tháng VN − 1 s không vào tháng này; at = đầu tháng → vào", async () => {
    const start = vnMonthStart(now());
    await insertUsage(env.owner, 1, {
      tenant: A,
      runFrom: 0,
      at: new Date(start.getTime() - 1000),
    });
    await insertUsage(env.owner, 1, { tenant: A, runFrom: 1, at: start });
    const b = parse4("UsageReportPlatformSchema", (await admin(`tenant_id=${A}&${range()}`)).json);
    expect(b.kpi.runs).toBe(1);
    expect(b.daily[0]).toMatchObject({ date: FROM(), runs: 1 });
  });

  it("ADM-FR-42 · M4-R09 · M4-AC13 · U8 · usage_logs rỗng → 200, has_data false, kpi 0 (admin và binh)", async () => {
    const res = await admin(`tenant_id=${A}`);
    expect(res.status).toBe(200);
    const b = parse4("UsageReportPlatformSchema", res.json);
    expect(b.has_data).toBe(false);
    expect([b.kpi.runs, b.kpi.tokens, n(b.kpi.billable_usd)]).toEqual([0, 0, 0]);
    const t = await binh();
    expect(t.status).toBe(200);
    expect(parse4("UsageReportTenantSchema", t.json).has_data).toBe(false);
  });
});
