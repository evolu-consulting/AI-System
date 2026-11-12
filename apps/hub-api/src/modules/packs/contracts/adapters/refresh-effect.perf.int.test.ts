// CR-127 K1a · spec §9 (Luật 4c): `contracts.refresh_effect` — MỘT UPDATE theo tập; 10.000 HĐ done (mọi hàng phải đổi) ≤ 2 s;
// lần hai (không hàng nào đổi) không ghi gì.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";

let o: Sql;
let T = "";
let U = "";
let ids: string[] = [];
const N = 10_000;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 9128)) as [string];
  [U] = (await users(o, T, 1, { from: 9128 })) as [string];
  const rows = await o<
    { id: string }[]
  >`insert into contracts.contracts (tenant_id, title, created_by, status, fields)
    select ${T}::uuid, 'HĐ perf ' || i, ${U}::uuid, 'done',
      jsonb_build_object('end_date', jsonb_build_object('value', (date '2026-11-10' + (i % 400) - 100)::text),
        'notice_days', jsonb_build_object('value', (i % 90)::text))
    from generate_series(1, ${N}::int) i returning id`;
  ids = rows.map((r) => r.id);
}, 300_000);

afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-127 K1a refresh_effect perf", () => {
  it(`${N} HĐ ≤ 2 s; chạy lại 0 hàng`, async () => {
    const t0 = performance.now();
    const [r] = await o<
      { n: number }[]
    >`select contracts.refresh_effect(${ids}::uuid[], '2026-11-10'::date) as n`;
    const ms = performance.now() - t0;
    console.log(`refresh_effect ${N} hàng: ${ms.toFixed(0)} ms (đổi ${r?.n})`);
    expect(r?.n).toBe(N);
    expect(ms).toBeLessThanOrEqual(2000);
    const [r2] = await o<
      { n: number }[]
    >`select contracts.refresh_effect(${ids}::uuid[], '2026-11-10'::date) as n`;
    expect(r2?.n).toBe(0);
  }, 60_000);
});
