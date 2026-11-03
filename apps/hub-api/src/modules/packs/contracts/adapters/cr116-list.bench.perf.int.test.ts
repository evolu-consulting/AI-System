// CR-116 · cr116-bench-apps · Luật 4c: A/B TRỰC TIẾP (không đoán) các phương án cho đường nóng danh sách HĐ — CHỈ ĐO, không đổi
// hành vi: biến thể policy RLS áp bằng `ALTER POLICY` TRONG một tx rồi ROLLBACK (DB test clone riêng); biến thể câu SQL = văn bản
// thật của `contractsRepo().list` (chụp qua `captureSql`) sửa tối thiểu. Cùng dữ liệu, cùng kết nối, xen kẽ biến thể mỗi vòng.
// Dữ liệu: tenant S 2.000 HĐ (cỡ prod) và L 50.000 HĐ, mỗi tenant 300 người phụ trách, quản lý V 60 cấp dưới (2 tầng), owner O;
// tenant nền 60.000 HĐ. Chế độ thấy `org`. Mỗi biến thể: kết quả (total + id trang) PHẢI bằng biến thể hiện tại.
// Chạy: `powershell deploy/evotest/run-tests.ps1 -Step perf -Exclusive -Filter <file này>`. In bảng `CR116|…` để chép vào report.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import {
  enablePack,
  managers,
  members,
  tenants,
  userId,
  users,
  visibility,
} from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { type Cap, captureSql, latencyStats } from "@ai/test-kit/perf";
import type { ContractListFilter } from "../application/ports";
import { contractsRepo } from "./contracts.repo";

const N = Number(process.env.CR116_N ?? 60);
const ROUNDS = 3;
const WARM = 5;
let sql: Sql;
let db: Db;

type Ten = { name: string; id: string; n: number; base: number; V: string; O: string };
const T: Ten[] = [];

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

async function seedTenant(t: Ten, ownerGroup: string): Promise<void> {
  await users(sql, t.id, 300, { from: t.base });
  const pairs: [string, string][] = [];
  for (let i = t.base + 1; i <= t.base + 20; i++) pairs.push([userId(i), t.V]);
  for (let i = t.base + 21; i <= t.base + 60; i++)
    pairs.push([userId(i), userId(t.base + 1 + ((i - t.base - 21) % 20))]);
  await managers(sql, t.id, pairs);
  await members(sql, t.id, ownerGroup, [t.O]);
  await sql.unsafe(
    `insert into contracts.contracts (tenant_id, title, status, owner_user_id, created_by, updated_at)
     select $1::uuid, 'HD ' || i, 'active', u.id, u.id, now() - (i || ' seconds')::interval
     from generate_series(1, $2::int) i
     cross join lateral (select ('7e5d00a2-0000-4000-8000-' || lpad(to_hex($3::int + (i % 300)), 12, '0'))::uuid as id) u`,
    [t.id, t.n, t.base],
  );
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  const [s, l, q] = (await tenants(sql, 3, 1601)) as [string, string, string];
  T.push({ name: "S 2k", id: s, n: 2000, base: 1001, V: userId(1001), O: userId(1299) });
  T.push({ name: "L 50k", id: l, n: 50_000, base: 3001, V: userId(3001), O: userId(3299) });
  await users(sql, q, 10, { from: 5001 });
  const roles = await enablePack(sql, [s, l, q], "contracts");
  for (const t of T) await seedTenant(t, roles.get(t.id)?.owner as string);
  await sql.unsafe(
    `insert into contracts.contracts (tenant_id, title, status, owner_user_id, created_by)
     select $1::uuid, 'Nen ' || i, 'active', $2::uuid, $2::uuid from generate_series(1, 60000) i`,
    [q, userId(5001)],
  );
  await visibility(sql, [s, l, q], "org");
  await sql`analyze contracts.contracts`;
  await sql`analyze admin.user_reports`;
  await sql`analyze admin.group_members`;
  db = createDb(urls().hubApi, { max: 2 });
}, 600_000);

afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const client = (): Sql => (db.db as unknown as { $client: Sql }).$client;

/** Chụp [set_config, list] của đường chạy thật. */
async function capture(t: Ten, who: string, f: ContractListFilter) {
  const { r, queries } = await captureSql(client(), () =>
    withPackScope(db, { packKey: "contracts", tenantId: t.id, userId: who }, (tx) =>
      contractsRepo(tx, t.id).list(f),
    ),
  );
  return { r, queries };
}

class Rollback extends Error {}
type Run = { ms: number[]; out: unknown };
/** Một tx chủ DB: (tuỳ chọn) ALTER POLICY biến thể → set_config như app → đo `n` lượt `q` → ROLLBACK. */
async function runVariant(
  scope: Cap,
  policy: string | null,
  q: (tx: Sql) => Promise<unknown>,
  n = N,
): Promise<Run> {
  let res: Run = { ms: [], out: null };
  try {
    await sql.begin(async (tx) => {
      if (policy)
        await tx.unsafe(`alter policy contracts_visible on contracts.contracts using (${policy})`);
      await tx.unsafe(scope.text, scope.params as never[]);
      for (let i = 0; i < WARM; i++) await q(tx);
      const ms: number[] = [];
      let out: unknown = null;
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        out = await q(tx);
        ms.push(performance.now() - t0);
      }
      res = { ms, out };
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return res;
}

async function explain(scope: Cap, policy: string | null, text: string, params: unknown[]) {
  let plan = "";
  try {
    await sql.begin(async (tx) => {
      if (policy)
        await tx.unsafe(`alter policy contracts_visible on contracts.contracts using (${policy})`);
      await tx.unsafe(scope.text, scope.params as never[]);
      const rows = (await tx.unsafe(
        `explain (analyze, buffers, costs off, timing off, summary on) ${text}`,
        params as never[],
      )) as unknown as { "QUERY PLAN": string }[];
      plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return plan;
}

type Variant = {
  name: string;
  policy: string | null;
  q: (tx: Sql) => Promise<unknown>;
  sqlCount: number;
};
/** Xen kẽ biến thể ROUNDS vòng; gộp ms; so `key(out)` với biến thể đầu. */
async function compare(
  label: string,
  t: Ten,
  scope: Cap,
  vs: Variant[],
  key: (o: unknown) => string,
): Promise<boolean> {
  const all = new Map<string, number[]>(vs.map((v) => [v.name, []]));
  const outs = new Map<string, string>();
  for (let r = 0; r < ROUNDS; r++)
    for (const v of vs) {
      const run = await runVariant(scope, v.policy, v.q);
      all.get(v.name)?.push(...run.ms);
      outs.set(v.name, key(run.out));
    }
  const base = outs.get(vs[0]?.name as string);
  let ok = true;
  for (const v of vs) {
    const st = latencyStats(all.get(v.name) as number[]);
    const eq = outs.get(v.name) === base;
    ok &&= eq;
    console.log(
      `CR116|${label}|${v.name}|${t.n}|${st.p50.toFixed(2)}|${st.p95.toFixed(2)}|${v.sqlCount}|${eq ? "✓" : "✗"}`,
    );
  }
  return ok;
}

type ListRow = { total: number; items: unknown };
const listKey = (o: unknown): string => {
  const r = (o as ListRow[])[0] as ListRow;
  const items = typeof r.items === "string" ? JSON.parse(r.items) : r.items;
  return `${r.total}:${(items as { id: string }[]).map((i) => i.id).join(",")}`;
};

// ── Policy `contracts_visible` (0070) — nhánh cây quản lý ──────────────────────────────────────────────────────────────────
const P_HEAD = `(SELECT contracts.sees_all() OR coalesce(current_setting('app.vis_cascade', true), '') = '1')`;
const P_TAIL = `OR id IN (SELECT unnest(contracts.reviewer_contract_ids()))`;
const POL_ANY = `${P_HEAD}
  OR owner_user_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])
  OR (owner_user_id IS NULL AND (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
       OR visibility_owner_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])))
  ${P_TAIL}`;
const POL_IN = `${P_HEAD}
  OR owner_user_id IN (SELECT unnest(contracts.org_owner_ids()))
  OR (owner_user_id IS NULL AND (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
       OR visibility_owner_id IN (SELECT unnest(contracts.org_owner_ids()))))
  ${P_TAIL}`;
const POL_EXISTS = `${P_HEAD}
  OR EXISTS (SELECT 1 FROM unnest((SELECT contracts.org_owner_ids())) o(u) WHERE o.u = owner_user_id)
  OR (owner_user_id IS NULL AND (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
       OR EXISTS (SELECT 1 FROM unnest((SELECT contracts.org_owner_ids())) o(u) WHERE o.u = visibility_owner_id)))
  ${P_TAIL}`;

const replay =
  (c: Cap, text = c.text) =>
  (tx: Sql) =>
    tx.unsafe(text, c.params as never[]);

/** Biến thể câu danh sách: ORDER BY tĩnh thay CASE (văn bản riêng mỗi kiểu sắp xếp). */
const staticOrder = (text: string): string =>
  text.replace(
    /p as \(select f\.id from f order by[\s\S]*?f\.id desc/,
    "p as (select f.id from f order by f.updated_at desc, f.id desc",
  );
const notMaterialized = (text: string): string =>
  staticOrder(text).replace("with f as materialized", "with f as not materialized");

describe("CR-116 · A/B danh sách HĐ", () => {
  it("SQL mỗi request (list, detail) — đường chạy thật", async () => {
    for (const t of T) {
      const { r, queries } = await capture(t, t.V, filter);
      const id = (r.items[0] as { id: string }).id;
      const d = await captureSql(client(), () =>
        withPackScope(db, { packKey: "contracts", tenantId: t.id, userId: t.V }, (tx) =>
          contractsRepo(tx, t.id).detail(id),
        ),
      );
      console.log(
        `CR116-SQLCOUNT|${t.name}|list=${queries.length}|detail=${d.queries.length}|total=${r.total}`,
      );
      expect(queries.length).toBe(2);
    }
  }, 120_000);

  it("C1 · RLS cây quản lý: = ANY(mảng) vs IN (unnest) hashed vs EXISTS(unnest)", async () => {
    let ok = true;
    for (const t of T) {
      const { queries } = await capture(t, t.V, filter);
      const [scope, list] = queries as [Cap, Cap];
      ok &&= await compare(
        "C1 rls-owner (V, list p1)",
        t,
        scope,
        [
          { name: "A = ANY (hiện tại)", policy: POL_ANY, q: replay(list), sqlCount: 2 },
          { name: "B IN (select unnest)", policy: POL_IN, q: replay(list), sqlCount: 2 },
          { name: "C EXISTS unnest", policy: POL_EXISTS, q: replay(list), sqlCount: 2 },
        ],
        listKey,
      );
      if (t.n > 10_000) {
        console.log(
          `CR116-EXPLAIN C1-A ${t.name}\n${await explain(scope, POL_ANY, list.text, list.params)}`,
        );
        console.log(
          `CR116-EXPLAIN C1-B ${t.name}\n${await explain(scope, POL_IN, list.text, list.params)}`,
        );
      }
    }
    expect(ok).toBe(true);
  }, 900_000);

  it("C2 · ORDER BY CASE (1 văn bản) vs ORDER BY tĩnh vs tĩnh + CTE không materialize", async () => {
    let ok = true;
    for (const t of T)
      for (const who of [t.V, t.O]) {
        const { queries } = await capture(t, who, filter);
        const [scope, list] = queries as [Cap, Cap];
        ok &&= await compare(
          `C2 order (${who === t.V ? "V" : "O"}, list p1)`,
          t,
          scope,
          [
            {
              name: "A CASE + materialized (hiện tại)",
              policy: null,
              q: replay(list),
              sqlCount: 2,
            },
            {
              name: "B tĩnh + materialized",
              policy: null,
              q: replay(list, staticOrder(list.text)),
              sqlCount: 2,
            },
            {
              name: "C tĩnh + not materialized",
              policy: null,
              q: replay(list, notMaterialized(list.text)),
              sqlCount: 2,
            },
          ],
          listKey,
        );
        if (t.n > 10_000 && who === t.O)
          console.log(
            `CR116-EXPLAIN C2-A ${t.name} O\n${await explain(scope, null, list.text, list.params)}`,
          );
      }
    expect(ok).toBe(true);
  }, 900_000);

  it("C3 · trang cuối: OFFSET vs keyset (updated_at, id) — O thấy cả tenant", async () => {
    let ok = true;
    for (const t of T) {
      const { queries } = await capture(t, t.O, { ...filter, offset: t.n - 20 });
      const [scope, list] = queries as [Cap, Cap];
      // Con trỏ = hàng cuối trang kề trước (đọc một lần, như client giữ con trỏ).
      const cur = (
        await runVariant(
          scope,
          null,
          (tx) => tx`select updated_at::text as u, id::text as id from contracts.contracts
          where tenant_id = ${t.id}::uuid and superseded_at is null
          order by updated_at desc, id desc offset ${t.n - 21} limit 1`,
          1,
        )
      ).out as { u: string; id: string }[];
      const c0 = cur[0] as { u: string; id: string };
      const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id).join(",");
      ok &&= await compare(
        "C3 page-last (O, chỉ trang)",
        t,
        scope,
        [
          {
            name: "A OFFSET n-20",
            policy: null,
            q: (
              tx,
            ) => tx`select id from contracts.contracts where tenant_id = ${t.id}::uuid and superseded_at is null
              order by updated_at desc, id desc limit 20 offset ${t.n - 20}`,
            sqlCount: 2,
          },
          {
            name: "B keyset (u,id) <",
            policy: null,
            q: (
              tx,
            ) => tx`select id from contracts.contracts where tenant_id = ${t.id}::uuid and superseded_at is null
              and (updated_at, id) < (${c0.u}::timestamptz, ${c0.id}::uuid)
              order by updated_at desc, id desc limit 20`,
            sqlCount: 2,
          },
        ],
        ids,
      );
      // Ngữ cảnh: câu list thật trang đầu vs trang cuối (cùng `count(*)` toàn tập lọc).
      const first = await capture(t, t.O, filter);
      const [s1, l1] = first.queries as [Cap, Cap];
      const a = latencyStats((await runVariant(s1, null, replay(l1))).ms);
      const b = latencyStats((await runVariant(scope, null, replay(list))).ms);
      console.log(
        `CR116|C3 list-real (O)|trang đầu|${t.n}|${a.p50.toFixed(2)}|${a.p95.toFixed(2)}|2|-\nCR116|C3 list-real (O)|trang cuối OFFSET|${t.n}|${b.p50.toFixed(2)}|${b.p95.toFixed(2)}|2|-`,
      );
    }
    expect(ok).toBe(true);
  }, 900_000);
});
