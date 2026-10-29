// M1D-NFR-01 · Luật 4c · ngân sách HD1/HD5: danh sách HĐ dưới luật thấy (chế độ org) p95 ≤ 50 ms, 2 câu SQL (set_config + list),
// EXPLAIN không Seq Scan trên contracts. Dữ liệu: tenant P 10.000 HĐ / 300 người phụ trách + tenant nền 60.000 HĐ. Người xem:
// quản lý V (60 cấp dưới, 2 tầng), trưởng phòng H (30 thành viên), editor lẻ E, owner O; đối chứng chế độ tenant.
// Đường chạy thật: `withPackScope` (pool hub_api) + `contractsRepo().list`. Chạy: `-Step perf -Filter tests/acceptance/M1D/perf`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import {
  department,
  enablePack,
  managers,
  members,
  tenants,
  userId,
  users,
  visibility,
} from "@ai/test-kit/builders";
import { cloneDb, inPackAs, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { assertNoSeqScan, captureSql, measure } from "@ai/test-kit/perf";
import { contractsRepo } from "../../../../apps/hub-api/src/modules/packs/contracts/adapters/contracts.repo";
import type { ContractListFilter } from "../../../../apps/hub-api/src/modules/packs/contracts/application/ports";

const N = 200;
let sql: Sql;
let db: Db;
let P = "";
let Q = "";
const V = userId(1001);
const H = userId(1100);
const E = userId(1250);
const O = userId(1300);

const filter: ContractListFilter = {
  status: null,
  owner: null,
  category: null,
  seller: null,
  buyer: null,
  signerKeys: null,
  direction: null,
  kind: null,
  valueMin: null,
  valueMax: null,
  dateField: "end_date",
  dateFrom: null,
  dateTo: null,
  like: null,
  order: "updated_at:desc",
  limit: 20,
  offset: 0,
};
const asUser =
  (who: string) =>
  <R>(fn: (tx: Sql) => Promise<R>): Promise<R> =>
    inPackAs("contracts", P, who, fn);
const list = (user: string, f: ContractListFilter = filter) =>
  withPackScope(db, { packKey: "contracts", tenantId: P, userId: user }, (tx) =>
    contractsRepo(tx, P).list(f),
  );

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [P, Q] = (await tenants(sql, 2, 1001)) as [string, string];
  await users(sql, P, 300, { from: 1001 });
  await users(sql, Q, 10, { from: 2001 });
  const roles = await enablePack(sql, [P, Q], "contracts");
  await members(sql, P, roles.get(P)?.owner as string, [O]);
  // V = 1001; 1002…1021 báo cáo V; 1022…1061 báo cáo 1002…1021 (2 mỗi người) ⇒ 60 cấp dưới, 2 tầng.
  const pairs: [string, string][] = [];
  for (let i = 1002; i <= 1021; i++) pairs.push([userId(i), V]);
  for (let i = 1022; i <= 1061; i++) pairs.push([userId(i), userId(1002 + ((i - 1022) % 20))]);
  await managers(sql, P, pairs);
  const dept = Array.from({ length: 30 }, (_, k) => userId(1101 + k));
  await department(sql, P, "kd", { head: H, members: dept });
  await sql.unsafe(
    `insert into contracts.contracts (tenant_id, title, status, owner_user_id, created_by, updated_at)
     select $1::uuid, 'HD ' || i, 'active', u.id, u.id, now() - (i || ' minutes')::interval
     from generate_series(1, 10000) i
     cross join lateral (select ('7e5d00a2-0000-4000-8000-' || lpad(to_hex(1001 + (i % 300)), 12, '0'))::uuid as id) u`,
    [P],
  );
  await sql.unsafe(
    `insert into contracts.contracts (tenant_id, title, status, owner_user_id, created_by)
     select $1::uuid, 'Nền ' || i, 'active', $2::uuid, $2::uuid from generate_series(1, 60000) i`,
    [Q, userId(2001)],
  );
  await visibility(sql, [P, Q], "org");
  await sql`analyze contracts.contracts`;
  await sql`analyze admin.user_reports`;
  db = createDb(urls().hubApi, { max: 4 });
}, 300_000);

afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("M1D-NFR-01 · danh sách dưới luật thấy", () => {
  const cases: [string, string, number][] = [
    ["quản lý V (60 cấp dưới)", V, 61],
    ["trưởng phòng H (30 thành viên)", H, 31],
    ["editor lẻ E", E, 1],
    ["owner O (cả tenant)", O, 300],
  ];
  for (const [name, who, owners] of cases) {
    it(`[${name}] p95 ≤ 50 ms, 2 câu SQL, đúng số HĐ`, async () => {
      const st = await measure(() => list(who), { n: N });
      const client = (db.db as unknown as { $client: Sql }).$client;
      const { r, queries } = await captureSql(client, () => list(who));
      const want = Math.round((10000 * owners) / 300);
      console.log(
        `M1D-NFR-01 · [${name}] p50=${st.p50.toFixed(2)} p95=${st.p95.toFixed(2)} max=${st.max.toFixed(1)} ms (n=${st.n}) · SQL=${queries.length} · total=${r.total}`,
      );
      expect({ sql: queries.length, total: Math.abs(r.total - want) <= owners }).toEqual({
        sql: 2,
        total: true,
      });
      expect(st.p95).toBeLessThanOrEqual(50);
    }, 120_000);
  }
  it("đối chứng chế độ tenant: editor lẻ thấy cả 10.000, p95 ≤ 50 ms", async () => {
    await visibility(sql, [P], "tenant");
    try {
      const st = await measure(() => list(E), { n: N });
      const r = await list(E);
      console.log(`M1D-NFR-01 · [tenant mode, E] p95=${st.p95.toFixed(2)} ms · total=${r.total}`);
      expect(r.total).toBe(10000);
      expect(st.p95).toBeLessThanOrEqual(50);
    } finally {
      await visibility(sql, [P], "org");
    }
  }, 120_000);
  it("EXPLAIN dưới RLS của V và H: không Seq Scan trên contracts", async () => {
    const client = (db.db as unknown as { $client: Sql }).$client;
    const { queries } = await captureSql(client, () => list(V));
    const main = queries.filter((q) => !/^\s*select set_config/i.test(q.text));
    for (const who of [V, H])
      for (const q of main) await assertNoSeqScan(asUser(who), q, ["contracts"]);
    expect(main.length).toBe(1);
  }, 60_000);
});
