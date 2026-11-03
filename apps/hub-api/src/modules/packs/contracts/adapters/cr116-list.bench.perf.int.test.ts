// CR-116 · cr116-bench-apps · Luật 4c: A/B TRỰC TIẾP (không đoán) các phương án cho đường nóng danh sách HĐ — CHỈ ĐO, không đổi
// hành vi: biến thể DDL (policy RLS, index pg_trgm) áp TRONG một tx rồi ROLLBACK (DB test clone riêng); biến thể câu SQL = văn bản
// thật của `contractsRepo().list` (chụp qua `captureSql`) sửa tối thiểu. Cùng dữ liệu, cùng kết nối, xen kẽ biến thể ROUNDS vòng.
// Dữ liệu: tenant S 2.000 HĐ (cỡ prod) và L 50.000 HĐ, mỗi tenant 300 người phụ trách, quản lý V 60 cấp dưới (2 tầng), owner O;
// tenant nền Q 60.000 HĐ. Chế độ thấy `org`. Mỗi biến thể chấm 3 tiêu chí: (1) tin cậy — kết quả (total + id trang) BẰNG biến thể
// hiện tại VÀ chạy cùng câu dưới phạm vi tenant Q ⇒ 0 hàng (RLS vẫn chặn chéo tenant); (2) tài nguyên — EXPLAIN (ANALYZE, BUFFERS):
// shared hit+read, temp blocks, 1 kết nối; (3) p50/p95.
// Chạy: `powershell deploy/evotest/run-tests.ps1 -Step perf -Exclusive -Filter <file này>`. In dòng `CR116|…` để chép vào report.
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
let foreign: Cap; // set_config của người tenant Q (kiểm chặn chéo tenant)

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

const client = (): Sql => (db.db as unknown as { $client: Sql }).$client;

/** Chụp [set_config, list] của đường chạy thật. */
async function capture(tid: string, who: string, f: ContractListFilter) {
  const c = await captureSql(client(), () =>
    withPackScope(db, { packKey: "contracts", tenantId: tid, userId: who }, (tx) =>
      contractsRepo(tx, tid).list(f),
    ),
  );
  const scope = c.queries.find((x) => x.text.includes("set_config('role'"));
  const list = c.queries.find((x) => x.text.includes("with f as materialized"));
  if (!scope || !list) throw new Error(`capture: thiếu câu scope/list (${c.queries.length} câu)`);
  return { r: c.r, queries: [scope, list] as Cap[], all: c.queries.length };
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
  await members(sql, q, roles.get(q)?.owner as string, [userId(5001)]);
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
  foreign = (await capture(q, userId(5001), filter)).queries[0] as Cap;
}, 600_000);

afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

type Variant = { name: string; setup: string[]; text: string; params: unknown[] };
class Rollback extends Error {}

/** Một tx chủ DB: DDL biến thể → set_config như app → `body(tx)` → ROLLBACK (không để lại dấu vết). */
async function inVariant<R>(
  scope: Cap,
  setup: string[],
  body: (tx: Sql) => Promise<R>,
): Promise<R> {
  let out: R | undefined;
  try {
    await sql.begin(async (tx) => {
      for (const s of setup) await tx.unsafe(s);
      await tx.unsafe(scope.text, scope.params as never[]);
      out = await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as R;
}

const q = (v: Variant) => (tx: Sql) => tx.unsafe(v.text, v.params as never[]);

async function timeIt(scope: Cap, v: Variant): Promise<{ ms: number[]; out: unknown }> {
  return inVariant(scope, v.setup, async (tx) => {
    for (let i = 0; i < WARM; i++) await q(v)(tx);
    const ms: number[] = [];
    let out: unknown = null;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      out = await q(v)(tx);
      ms.push(performance.now() - t0);
    }
    return { ms, out };
  });
}

type PlanJ = { Plan: Record<string, number>; "Execution Time": number };
/** Tài nguyên: shared hit+read, temp written, thời gian thực thi phía server (EXPLAIN ANALYZE BUFFERS). */
async function resources(scope: Cap, v: Variant, text = false): Promise<string> {
  return inVariant(scope, v.setup, async (tx) => {
    await q(v)(tx); // nóng
    if (text) {
      const r = (await tx.unsafe(
        `explain (analyze, buffers, costs off, timing off) ${v.text}`,
        v.params as never[],
      )) as unknown as { "QUERY PLAN": string }[];
      return r.map((x) => x["QUERY PLAN"]).join("\n");
    }
    const r = (await tx.unsafe(
      `explain (analyze, buffers, format json) ${v.text}`,
      v.params as never[],
    )) as unknown as { "QUERY PLAN": PlanJ[] }[];
    const j = r[0]?.["QUERY PLAN"]?.[0] as PlanJ;
    const p = j.Plan;
    const bufs = (p["Shared Hit Blocks"] ?? 0) + (p["Shared Read Blocks"] ?? 0);
    return `buf=${bufs} temp=${p["Temp Written Blocks"] ?? 0} exec=${j["Execution Time"].toFixed(2)}ms conn=1`;
  });
}

/** Xen kẽ biến thể ROUNDS vòng; in `CR116|nhãn|biến thể|hàng|p50|p95|SQL|bằng|chéo-tenant|tài nguyên`. */
async function compare(
  label: string,
  rows: number,
  scope: Cap,
  vs: Variant[],
  key: (o: unknown) => string,
  explainOf: number[] = [],
): Promise<boolean> {
  const ms = new Map<string, number[]>(vs.map((v) => [v.name, []]));
  const outs = new Map<string, string>();
  for (let r = 0; r < ROUNDS; r++)
    for (const v of vs) {
      const run = await timeIt(scope, v);
      ms.get(v.name)?.push(...run.ms);
      outs.set(v.name, key(run.out));
    }
  const base = outs.get(vs[0]?.name as string);
  let ok = true;
  for (const [i, v] of vs.entries()) {
    const st = latencyStats(ms.get(v.name) as number[]);
    const eq = outs.get(v.name) === base;
    const cross = key(await inVariant(foreign, v.setup, q(v)));
    const isolated = cross === key([]) || cross === key([{ total: 0, items: [] }]);
    ok = ok && eq && isolated;
    const res = await resources(scope, v);
    console.log(
      `CR116|${label}|${v.name}|${rows}|${st.p50.toFixed(2)}|${st.p95.toFixed(2)}|2|${eq ? "✓" : "✗"}|${isolated ? "✓" : `✗ ${cross.slice(0, 40)}`}|${res}|mean=${mean(ms.get(v.name) as number[]).toFixed(2)}`,
    );
    if (explainOf.includes(i))
      console.log(`CR116-EXPLAIN ${label} ${v.name} ${rows}\n${await resources(scope, v, true)}`);
  }
  return ok;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
type ListRow = { total: number; items: unknown };
const listKey = (o: unknown): string => {
  const r = (o as ListRow[])[0];
  if (!r) return "0:";
  const items = typeof r.items === "string" ? JSON.parse(r.items) : r.items;
  return `${r.total}:${(items as { id: string }[]).map((i) => i.id).join(",")}`;
};
const idsKey = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id).join(",");

// ── Policy `contracts_visible` (0070) — nhánh cây quản lý ──────────────────────────────────────────────────────────────────
const P_HEAD = `(SELECT contracts.sees_all() OR coalesce(current_setting('app.vis_cascade', true), '') = '1')`;
const P_TAIL = `OR id IN (SELECT unnest(contracts.reviewer_contract_ids()))`;
const ME = `NULLIF(current_setting('app.user_id', true), '')::uuid`;
const pol = (owner: (col: string) => string) =>
  `alter policy contracts_visible on contracts.contracts using (${P_HEAD}
  OR ${owner("owner_user_id")}
  OR (owner_user_id IS NULL AND (created_by = ${ME} OR ${owner("visibility_owner_id")}))
  ${P_TAIL})`;
const POL_ANY = pol((c) => `${c} = ANY ((SELECT contracts.org_owner_ids())::uuid[])`);
const POL_IN = pol((c) => `${c} IN (SELECT unnest(contracts.org_owner_ids()))`);
const POL_EXISTS = pol(
  (c) => `EXISTS (SELECT 1 FROM unnest((SELECT contracts.org_owner_ids())) o(u) WHERE o.u = ${c})`,
);

const v = (name: string, c: Cap, text = c.text, setup: string[] = []): Variant => ({
  name,
  setup,
  text,
  params: c.params,
});

/** ORDER BY tĩnh thay CASE (văn bản riêng mỗi kiểu sắp xếp). */
const staticOrder = (text: string): string =>
  text.replace(/p as \(select f\.id from f order by[\s\S]*?f\.id desc/, (m) => {
    // Giữ tham số `order` được tham chiếu (kiểu xác định lúc parse; `… or true` bị gấp hằng ⇒ không ảnh hưởng kế hoạch).
    const ps = [...new Set([...m.matchAll(/\$(\d+)::text/g)].map((x) => `$${x[1]}::text is null`))];
    return `p as (select f.id from f where (${ps.join(" or ")} or true) order by f.updated_at desc, f.id desc`;
  });
const notMaterialized = (text: string): string =>
  staticOrder(text).replace("with f as materialized", "with f as not materialized");

describe("CR-116 · A/B danh sách HĐ", () => {
  it("SQL mỗi request (list, detail) — đường chạy thật", async () => {
    for (const t of T) {
      const { r, all } = await capture(t.id, t.V, filter);
      const id = (r.items[0] as { id: string }).id;
      const d = await captureSql(client(), () =>
        withPackScope(db, { packKey: "contracts", tenantId: t.id, userId: t.V }, (tx) =>
          contractsRepo(tx, t.id).detail(id),
        ),
      );
      console.log(
        `CR116-SQLCOUNT|${t.name}|list=${all}|detail=${d.queries.length}|total=${r.total}`,
      );
      expect(all).toBe(2);
    }
  }, 120_000);

  it("C1 · RLS cây quản lý: = ANY(mảng) vs IN (unnest) hashed vs EXISTS(unnest)", async () => {
    let ok = true;
    for (const t of T) {
      const [scope, list] = (await capture(t.id, t.V, filter)).queries as [Cap, Cap];
      ok =
        (await compare(
          "C1 rls-owner (V, list p1)",
          t.n,
          scope,
          [
            v("A = ANY (hiện tại)", list, list.text, [POL_ANY]),
            v("B IN (select unnest)", list, list.text, [POL_IN]),
            v("C EXISTS unnest", list, list.text, [POL_EXISTS]),
          ],
          listKey,
          t.n > 10_000 ? [0, 1] : [],
        )) && ok;
    }
    expect(ok).toBe(true);
  }, 900_000);

  it("C2 · ORDER BY CASE vs ORDER BY tĩnh vs tĩnh + CTE không materialize", async () => {
    let ok = true;
    for (const t of T)
      for (const who of [t.V, t.O]) {
        const [scope, list] = (await capture(t.id, who, filter)).queries as [Cap, Cap];
        ok =
          (await compare(
            `C2 order (${who === t.V ? "V" : "O"}, list p1)`,
            t.n,
            scope,
            [
              v("A CASE + materialized (hiện tại)", list),
              v("B tĩnh + materialized", list, staticOrder(list.text)),
              v("C tĩnh + not materialized", list, notMaterialized(list.text)),
            ],
            listKey,
            t.n > 10_000 && who === t.O ? [0, 2] : [],
          )) && ok;
      }
    expect(ok).toBe(true);
  }, 900_000);

  it("C3 · trang cuối: OFFSET vs keyset (updated_at, id) — O thấy cả tenant", async () => {
    let ok = true;
    for (const t of T) {
      const [scope] = (await capture(t.id, t.O, filter)).queries as [Cap, Cap];
      const cur = (await inVariant(
        scope,
        [],
        (tx) => tx`select updated_at::text as u, id::text as id from contracts.contracts
          where tenant_id = ${t.id}::uuid and superseded_at is null
          order by updated_at desc, id desc offset ${t.n - 21} limit 1`,
      )) as unknown as { u: string; id: string }[];
      const c0 = cur[0] as { u: string; id: string };
      const page = `select id from contracts.contracts where tenant_id = $1::uuid and superseded_at is null`;
      const ord = `order by updated_at desc, id desc limit 20`;
      ok =
        (await compare(
          "C3 page-last (O, chỉ trang)",
          t.n,
          scope,
          [
            {
              name: "A OFFSET n-20",
              setup: [],
              text: `${page} ${ord} offset $2::int`,
              params: [t.id, t.n - 20],
            },
            {
              name: "B keyset (u,id) <",
              setup: [],
              text: `${page} and (updated_at, id) < ($2::timestamptz, $3::uuid) ${ord}`,
              params: [t.id, c0.u, c0.id],
            },
          ],
          idsKey,
        )) && ok;
      // Ngữ cảnh: câu list THẬT trang đầu vs trang cuối (cùng `count(*)` toàn tập lọc).
      const [s2, last] = (await capture(t.id, t.O, { ...filter, offset: t.n - 20 })).queries as [
        Cap,
        Cap,
      ];
      const [, first] = (await capture(t.id, t.O, filter)).queries as [Cap, Cap];
      await compare(
        "C3 list-real (O)",
        t.n,
        s2,
        [v("trang đầu", first), v("trang cuối OFFSET", last)],
        () => "-",
      );
    }
    expect(ok).toBe(true);
  }, 900_000);

  it("C5 · tìm HĐ `search_key LIKE '%q%'`: không index vs GIN pg_trgm", async () => {
    let ok = true;
    for (const t of T) {
      const [scope, list] = (await capture(t.id, t.O, { ...filter, like: "%777%" })).queries as [
        Cap,
        Cap,
      ];
      ok =
        (await compare(
          "C5 search q=777 (O)",
          t.n,
          scope,
          [
            v("A LIKE, index b-tree hiện có", list),
            v("B + GIN pg_trgm(search_key)", list, list.text, [
              "create extension if not exists pg_trgm",
              "create index cr116_trgm on contracts.contracts using gin (search_key gin_trgm_ops)",
              "analyze contracts.contracts",
            ]),
          ],
          listKey,
          t.n > 10_000 ? [0, 1] : [],
        )) && ok;
    }
    expect(ok).toBe(true);
  }, 900_000);
});
