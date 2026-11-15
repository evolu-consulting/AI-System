// CR-169 · lát 3a · Luật 4c · đo danh bạ + danh sách công ty của Tin nhắn (spec §6) trên DB thật: công ty A kết nối 49 công ty, mỗi công ty 100 người
// = 5.000 người đều có quyền Sổ Hợp Tác. Ngưỡng: danh bạ 30 người (`all`) p95 ≤ 40 ms, danh sách công ty (500 kết nối ⇒ ở đây 49) p95 ≤ 20 ms, mỗi thao tác
// MỘT câu SQL. In số thật ra console (trước → sau ghi ở docs/specs/CR-169/tasks.md).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";

const COMPANIES = 50; // A + 49 kết nối
const PER = 100;
const RUNS = 40;
const A = tenantId(1700);
const ME = userId(170000);
let o: Sql;
let statements = 0;

const as = <T>(fn: (tx: Sql) => Promise<T>) =>
  inHub({ kind: "user", tenantId: A, userId: ME }, async (tx) => {
    statements++;
    return fn(tx);
  });
type Person = { user_id: string; name: string; tenant_id: string; sort_key: string };
const people = (q: string | null, cur: { k: string; id: string } | null, limit = 30) =>
  as(
    (tx) =>
      tx<
        Person[]
      >`select * from hub.pmsg_people(${null}::uuid[], ${q}::text, ${cur?.k ?? null}::text, ${cur?.id ?? null}::uuid, ${limit}::int)`,
  );
const companies = (limit = 30) =>
  as(
    (tx) =>
      tx<{ company_id: string }[]>`select * from hub.pmsg_companies(null, null, ${limit}::int)`,
  );

async function measure(
  name: string,
  fn: () => Promise<unknown>,
): Promise<{ p95: number; sql: number }> {
  await fn();
  const ms: number[] = [];
  statements = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const p95 = ms[Math.ceil(RUNS * 0.95) - 1] ?? 0;
  const per = statements / RUNS;
  console.log(`[perf CR-169 3a] ${name}: p95 ${p95.toFixed(1)} ms · ${per} câu SQL / thao tác`);
  return { p95, sql: per };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const ts = Array.from({ length: COMPANIES }, (_, k) => tenantId(1700 + k));
  await o`insert into admin.tenants (id, key, name, legal_name)
    select t::uuid, 'pp' || i, 'Cty ' || i, 'Công ty số ' || i from jsonb_array_elements_text(${JSON.stringify(ts)}::text::jsonb) with ordinality as x(t, i)`;
  const g = await enablePack(o, ts, "contracts");
  for (const [k, t] of ts.entries()) {
    const ids = await users(o, t, PER, { from: 170000 + k * PER });
    await members(o, t, g.get(t)?.viewer as string, ids);
  }
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    select a, b, now() from (select ${A}::uuid as a, t::uuid as b from jsonb_array_elements_text(${JSON.stringify(ts.slice(1))}::text::jsonb) t
                             union all select t::uuid, ${A}::uuid from jsonb_array_elements_text(${JSON.stringify(ts.slice(1))}::text::jsonb) t) x`;
  await o`analyze admin.users`;
  await o`analyze admin.group_members`;
  await o`analyze admin.feature_grants`;
}, 300_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-169 3a · perf danh bạ (5.000 người / 50 công ty)", () => {
  it("danh bạ 30 người (`all`): 1 câu, p95 ≤ 40 ms, đủ 5.000 − 1 người qua phân trang keyset", async () => {
    const r = await measure("pmsg_people all (30)", () => people(null, null));
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(40);
    const first = await people(null, null, 101);
    expect(first).toHaveLength(101);
    const last = first[100] as Person;
    const next = await people(null, { k: last.sort_key, id: last.user_id }, 5);
    expect(next.map((x) => x.user_id)).not.toContain(last.user_id);
  });

  it("danh bạ tìm theo tên: 1 câu, p95 ≤ 40 ms", async () => {
    const r = await measure("pmsg_people q (30)", () => people("user 1700", null));
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(40);
  });

  it("danh sách công ty: 1 câu, p95 ≤ 20 ms", async () => {
    const r = await measure("pmsg_companies (30)", () => companies());
    expect(r.sql).toBe(1);
    expect(r.p95).toBeLessThanOrEqual(20);
    expect((await companies(101)).length).toBe(COMPANIES - 1);
  });
});
