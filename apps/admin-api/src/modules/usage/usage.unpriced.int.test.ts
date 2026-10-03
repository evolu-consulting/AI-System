// ADM-FR-42 · top_features/top_users có `unpriced_rows` = số hàng billable_usd NULL (cùng câu top, không thêm round-trip).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  createM4Env,
  ID,
  insertUsage,
  type M4Env,
  parse4,
  resetNow,
  TENANT_ID,
  vnDate,
  vnMonthStart,
} from "../../../../../tests/acceptance/M4/_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const KT = ID.feature.keToan;
const now = () => new Date();
const range = () =>
  `from=${vnDate(vnMonthStart(now()))}&to=${vnDate(new Date(vnMonthStart(now(), 1).getTime() - 1000))}`;

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
  await insertUsage(env.owner, 1, { tenant: A, feature: KT, runFrom: 0 });
  await insertUsage(env.owner, 1, { tenant: A, feature: KT, runFrom: 1, billable: null });
  await insertUsage(env.owner, 1, { tenant: A, runFrom: 2 });
});

describe("ADM-FR-42 · unpriced_rows ở top", () => {
  it("feature có 1 hàng NULL → unpriced_rows 1; feature đủ giá → 0; top_users cộng đủ", async () => {
    const r = await env.as("GET", `/admin/usage?tenant_id=${A}&${range()}`);
    const b = parse4("UsageReportPlatformSchema", r.json);
    const by = new Map(
      b.top_features.map((f: { feature_id: string | null; unpriced_rows: number }) => [
        f.feature_id,
        f.unpriced_rows,
      ]),
    );
    expect(by.get(KT)).toBe(1);
    expect(by.get(null)).toBe(0);
    const total = b.top_users.reduce(
      (s: number, u: { unpriced_rows: number }) => s + u.unpriced_rows,
      0,
    );
    expect(total).toBe(b.kpi.unpriced_rows);
    expect(total).toBe(1);
  });
});
