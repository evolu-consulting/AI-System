// CR-116 · cr116-bench-apps · harness A/B dùng chung cho các file `cr116-*.bench.perf.int.test.ts` (CHỈ ĐO, không thuộc sản phẩm).
// Dữ liệu: tenant S 2.000 HĐ (cỡ prod), L 50.000 HĐ (mỗi tenant 300 người phụ trách, quản lý V 60 cấp dưới 2 tầng, owner O),
// tenant nền Q 60.000 HĐ; chế độ thấy `org`. Biến thể DDL áp trong tx ROLLBACK; câu = văn bản thật chụp từ repo.
// Chấm 3 tiêu chí: (1) tin cậy — kết quả bằng biến thể A + chạy dưới phạm vi tenant Q ra 0 hàng; (2) tài nguyên — EXPLAIN (ANALYZE,
// BUFFERS) shared hit+read, temp, exec, 1 kết nối; (3) p50/p95/mean (ROUNDS vòng xen kẽ × N lượt).
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
import type { ContractListFilter } from "../../application/ports";
import { contractsRepo } from "../contracts.repo";

export const N = Number(process.env.CR116_N ?? 60);
export const ROUNDS = 3;
const WARM = 5;

export type Ten = { name: string; id: string; n: number; base: number; V: string; O: string };
/** Biến thể: văn bản + tham số (hoặc `run` tự chạy nhiều câu — khi đó không EXPLAIN). */
export type Variant = {
  name: string;
  setup: string[];
  text: string;
  params: unknown[];
  run?: (tx: Sql) => Promise<unknown>;
  sql?: number;
};

export const filter: ContractListFilter = {
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

class Rollback extends Error {}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const qOf = (v: Variant) => v.run ?? ((tx: Sql) => tx.unsafe(v.text, v.params as never[]));
type PlanJ = { Plan: Record<string, number>; "Execution Time": number; "Planning Time": number };

export class Bench {
  sql!: Sql;
  db!: Db;
  T: Ten[] = [];
  Q = "";
  foreign!: Cap;

  async setup(): Promise<void> {
    await cloneDb("full");
    this.sql = openOwner(2);
    const sql = this.sql;
    const [s, l, q] = (await tenants(sql, 3, 1601)) as [string, string, string];
    this.Q = q;
    this.T.push({ name: "S 2k", id: s, n: 2000, base: 1001, V: userId(1001), O: userId(1299) });
    this.T.push({ name: "L 50k", id: l, n: 50_000, base: 3001, V: userId(3001), O: userId(3299) });
    await users(sql, q, 10, { from: 5001 });
    const roles = await enablePack(sql, [s, l, q], "contracts");
    for (const t of this.T) await this.seedTenant(t, roles.get(t.id)?.owner as string);
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
    this.db = createDb(urls().hubApi, { max: 2 });
    this.foreign = (await this.capture(q, userId(5001), filter)).queries[0] as Cap;
  }

  private async seedTenant(t: Ten, ownerGroup: string): Promise<void> {
    const sql = this.sql;
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

  async close(): Promise<void> {
    await this.db?.close();
    await this.sql?.end({ timeout: 2 });
  }

  client(): Sql {
    return (this.db.db as unknown as { $client: Sql }).$client;
  }

  /** Chụp [set_config, list] của đường chạy thật (`all` = tổng số câu). */
  async capture(tid: string, who: string, f: ContractListFilter) {
    const c = await captureSql(this.client(), () =>
      withPackScope(this.db, { packKey: "contracts", tenantId: tid, userId: who }, (tx) =>
        contractsRepo(tx, tid).list(f),
      ),
    );
    const scope = c.queries.find((x) => x.text.includes("set_config('role'"));
    const list = c.queries.find((x) => x.text.includes("with f as materialized"));
    if (!scope || !list) throw new Error(`capture: thiếu câu scope/list (${c.queries.length} câu)`);
    return { r: c.r, queries: [scope, list] as Cap[], all: c.queries.length };
  }

  /** Một tx chủ DB: DDL biến thể → set_config như app → `body(tx)` → ROLLBACK. */
  async inVariant<R>(scope: Cap, setup: string[], body: (tx: Sql) => Promise<R>): Promise<R> {
    let out: R | undefined;
    try {
      await this.sql.begin(async (tx) => {
        for (const s of setup) await tx.unsafe(s);
        await tx.unsafe(scope.text, scope.params as never[]);
        out = await body(tx as unknown as Sql);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return out as R;
  }

  async timeIt(scope: Cap, v: Variant): Promise<{ ms: number[]; out: unknown }> {
    return this.inVariant(scope, v.setup, async (tx) => {
      for (let i = 0; i < WARM; i++) await qOf(v)(tx);
      const ms: number[] = [];
      let out: unknown = null;
      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        out = await qOf(v)(tx);
        ms.push(performance.now() - t0);
      }
      return { ms, out };
    });
  }

  /** EXPLAIN (ANALYZE, BUFFERS): json ⇒ tóm tắt tài nguyên; text ⇒ kế hoạch đầy đủ. */
  async resources(scope: Cap, v: Variant, text = false): Promise<string> {
    if (v.run) return "buf=n/a (nhiều câu) conn=1";
    return this.inVariant(scope, v.setup, async (tx) => {
      await qOf(v)(tx);
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
      return `buf=${bufs} temp=${p["Temp Written Blocks"] ?? 0} exec=${j["Execution Time"].toFixed(2)}ms plan=${j["Planning Time"].toFixed(2)}ms conn=1`;
    });
  }

  /** Xen kẽ biến thể; in `CR116|nhãn|biến thể|hàng|p50|p95|SQL|bằng|chéo-tenant|tài nguyên|mean[|info]`. */
  async compare(
    label: string,
    rows: number,
    scope: Cap,
    ...[vs, key, o = {}]: [
      vs: Variant[],
      key: (o: unknown) => string,
      o?: { explainOf?: number[]; info?: (out: unknown) => string },
    ]
  ): Promise<boolean> {
    const ms = new Map<string, number[]>(vs.map((v) => [v.name, []]));
    const outs = new Map<string, unknown>();
    for (let r = 0; r < ROUNDS; r++)
      for (const v of vs) {
        const run = await this.timeIt(scope, v);
        ms.get(v.name)?.push(...run.ms);
        outs.set(v.name, run.out);
      }
    const base = key(outs.get(vs[0]?.name as string));
    let ok = true;
    for (const [i, v] of vs.entries()) {
      const xs = ms.get(v.name) as number[];
      const st = latencyStats(xs);
      const eq = key(outs.get(v.name)) === base;
      const cross = key(await this.inVariant(this.foreign, v.setup, qOf(v)));
      const isolated = cross === key([]) || cross === key([{ total: 0, items: [] }]);
      ok = ok && eq && isolated;
      const res = await this.resources(scope, v);
      const info = o.info ? `|${o.info(outs.get(v.name))}` : "";
      console.log(
        `CR116|${label}|${v.name}|${rows}|${st.p50.toFixed(2)}|${st.p95.toFixed(2)}|${v.sql ?? 2}|${eq ? "✓" : "✗"}|${isolated ? "✓" : `✗ ${cross.slice(0, 40)}`}|${res}|mean=${mean(xs).toFixed(2)}${info}`,
      );
      if (o.explainOf?.includes(i))
        console.log(
          `CR116-EXPLAIN ${label} ${v.name} ${rows}\n${await this.resources(scope, v, true)}`,
        );
    }
    return ok;
  }
}

type ListRow = { total: number; items: unknown };
const itemsOf = (o: unknown): { id: string }[] => {
  const r = (o as ListRow[])[0];
  if (!r) return [];
  return (typeof r.items === "string" ? JSON.parse(r.items) : r.items) as { id: string }[];
};
export const totalOf = (o: unknown): number => (o as ListRow[])[0]?.total ?? 0;
export const listKey = (o: unknown): string =>
  `${totalOf(o)}:${itemsOf(o)
    .map((i) => i.id)
    .join(",")}`;
/** Chỉ id trang (biến thể đổi nghĩa `total` so riêng qua `info`). */
export const pageKey = (o: unknown): string =>
  itemsOf(o)
    .map((i) => i.id)
    .join(",");
export const idsKey = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id).join(",");

export const v = (name: string, c: Cap, text = c.text, setup: string[] = []): Variant => ({
  name,
  setup,
  text,
  params: c.params,
});

/** ORDER BY tĩnh thay CASE (văn bản riêng mỗi kiểu sắp xếp); giữ tham số `order` được tham chiếu (`… or true` gấp hằng). */
export const staticOrder = (text: string): string =>
  text.replace(/p as \(select f\.id from f order by[\s\S]*?f\.id desc/, (m) => {
    const ps = [...new Set([...m.matchAll(/\$(\d+)::text/g)].map((x) => `$${x[1]}::text is null`))];
    return `p as (select f.id from f where (${ps.join(" or ")} or true) order by f.updated_at desc, f.id desc`;
  });
export const notMaterialized = (text: string): string =>
  staticOrder(text).replace("with f as materialized", "with f as not materialized");
