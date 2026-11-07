// CR-116 · cr116-bench-apps vòng 2 (CHỈ ĐO): (1) /sourcing — thời gian lập kế hoạch vs thực thi, nestloop, kết nối lạnh;
// (2) `count(*)` + RLS từng dòng — đếm chính xác vs trần "1.000+" vs "có trang sau" vs ước lượng EXPLAIN vs bảng đếm;
// (3) tìm `LIKE %q%` — tách nhánh câu (bỏ `$q is null or`) để GIN pg_trgm dùng được; (6) Bun.sql vs postgres.js + cắt kết nối giữa tx.
// Dữ liệu/harness: `test/cr116-bench.harness.ts`. Chạy: `run-tests.ps1 -Step perf -Exclusive -Filter <file này>`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { openOwner } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { type Cap, latencyStats } from "@ai/test-kit/perf";
import { PRICED_STATUSES } from "./appendix.repo";
import {
  Bench,
  filter,
  listKey,
  notMaterialized,
  pageKey,
  type Ten,
  totalOf,
  type Variant,
  v,
} from "./test/cr116-bench.harness";

const B = new Bench();
beforeAll(() => B.setup(), 600_000);
afterAll(() => B.close());

const STATUSES = PRICED_STATUSES.map((s) => `'${s}'`).join(", ");
const VISIBLE = `select coalesce(json_agg(c.id), '[]'::json) as j from (select c.id from contracts.contracts c
  where c.tenant_id = $1::uuid and c.status in (${STATUSES}) and c.superseded_at is null limit 50000) c`;
const FPRINT = `select concat_ws('|', (select count(*)::text || ':' || coalesce(max(c.updated_at)::text, '') || ':' || coalesce(sum(c.version), 0)::text
  || ':' || coalesce(sum(hashtext(c.id::text || c.status || coalesce(c.direction, ''))), 0)::text
  from contracts.contracts c where c.tenant_id = $1::uuid and c.status in (${STATUSES}) and c.superseded_at is null),
  (select count(*)::text || ':' || coalesce(max(s.chosen_at)::text, '') from contracts.sourcing_choices s where s.tenant_id = $1::uuid)) as j`;

type PJ = { "Planning Time": number; "Execution Time": number };
async function planExec(scope: Cap, text: string, params: unknown[], pre: string[] = []) {
  return B.inVariant(scope, [], async (tx) => {
    for (const p of pre) await tx.unsafe(p);
    const r = (await tx.unsafe(
      `explain (analyze, summary, format json) ${text}`,
      params as never[],
    )) as unknown as {
      "QUERY PLAN": PJ[];
    }[];
    const j = r[0]?.["QUERY PLAN"]?.[0] as PJ;
    return `plan=${j["Planning Time"].toFixed(2)}ms exec=${j["Execution Time"].toFixed(2)}ms`;
  });
}
const lit = (text: string, params: unknown[]) =>
  text.replace(
    /\$(\d+)/g,
    (_m, n: string) => `'${String(params[Number(n) - 1]).replace(/'/g, "''")}'`,
  );

/** Kết nối MỚI mỗi lượt: câu đầu (lập kế hoạch lạnh + catalog cache lạnh) vs câu thứ 2 cùng kết nối. */
async function coldWarm(scope: Cap, text: string, params: unknown[], n = 10) {
  const cold: number[] = [];
  const warm: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = openOwner(1);
    await s.begin(async (tx) => {
      await tx.unsafe(scope.text, scope.params as never[]);
      let t0 = performance.now();
      await tx.unsafe(text, params as never[]);
      cold.push(performance.now() - t0);
      t0 = performance.now();
      await tx.unsafe(text, params as never[]);
      warm.push(performance.now() - t0);
    });
    await s.end({ timeout: 1 });
  }
  const a = latencyStats(cold);
  const b = latencyStats(warm);
  return `cold p50=${a.p50.toFixed(2)} p95=${a.p95.toFixed(2)} · warm p50=${b.p50.toFixed(2)} p95=${b.p95.toFixed(2)} ms`;
}

async function totalCase(t: Ten, who: string): Promise<boolean> {
  const [scope, list] = (await B.capture(t.id, who, filter)).queries as [Cap, Cap];
  const base = notMaterialized(list.text);
  const cap = (k: number) =>
    base.replace(
      "(select count(*) from f)::int as total",
      `(select count(*) from (select 1 from f limit ${k}) z)::int as total`,
    );
  if (cap(1001) === base) throw new Error("không tìm thấy biểu thức total");
  const body0 = /with f as not materialized \(([\s\S]*?)\),\s*p as/.exec(base)?.[1] as string;
  // Tham số không có trong thân f vẫn phải được tham chiếu (kiểu xác định lúc parse; `or true` gấp hằng).
  const used = new Set([...body0.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  const extra = list.params
    .map((_p, i) => i + 1)
    .filter((k) => !used.has(k))
    .map((k) => ` and ($${k}::text is null or true)`);
  const fBody = `${body0}${extra.join("")}`;
  const est: Variant = {
    name: "D ước lượng EXPLAIN + trang",
    setup: [],
    text: "",
    params: list.params,
    sql: 3,
    run: async (tx) => {
      const e = (await tx.unsafe(
        `explain (format json) ${fBody}`,
        list.params as never[],
      )) as unknown as {
        "QUERY PLAN": { Plan: { "Plan Rows": number } }[];
      }[];
      const rows = (await tx.unsafe(cap(21), list.params as never[])) as unknown as {
        total: number;
      }[];
      return [{ ...rows[0], total: e[0]?.["QUERY PLAN"]?.[0]?.Plan["Plan Rows"] ?? -1 }];
    },
  };
  const counter: Variant = {
    ...v(
      "E bảng đếm theo tenant",
      list,
      base.replace(
        "(select count(*) from f)::int as total",
        `(select n from contracts.cr116_counts k where k.tenant_id = '${t.id}'::uuid)::int as total`,
      ),
      [
        "create table contracts.cr116_counts (tenant_id uuid primary key, n int not null)",
        "insert into contracts.cr116_counts select tenant_id, count(*) from contracts.contracts where superseded_at is null group by 1",
        "grant select on contracts.cr116_counts to contracts_rw",
      ],
    ),
  };
  return B.compare(
    `C6 total (${who === t.V ? "V" : "O"})`,
    t.n,
    scope,
    [
      v("A count(*) chính xác (hiện tại)", list),
      v("B trần 1.000+ (not mat)", list, cap(1001)),
      v("C có-trang-sau (limit 21, not mat)", list, cap(21)),
      est,
      counter,
    ],
    pageKey,
    {
      info: (o) => `total=${totalOf(o)}`,
      explainOf: t.n > 10_000 && who === t.O ? [1] : [],
    },
  );
}

describe("CR-116 vòng 2", () => {
  it("(1) /sourcing: Planning vs Execution, nestloop on/off, tham số vs literal, kết nối lạnh", async () => {
    for (const t of B.T)
      for (const who of [t.V, t.O]) {
        const [scope, list] = (await B.capture(t.id, who, filter)).queries as [Cap, Cap];
        const tag = `${t.n}|${who === t.V ? "V" : "O"}`;
        for (const [name, text] of [
          ["visibleIds", VISIBLE],
          ["fingerprint", FPRINT],
        ] as const) {
          const p = [t.id];
          console.log(`CR116-PLAN|${name}|${tag}|param|${await planExec(scope, text, p)}`);
          console.log(
            `CR116-PLAN|${name}|${tag}|literal|${await planExec(scope, lit(text, p), [])}`,
          );
          console.log(
            `CR116-PLAN|${name}|${tag}|literal+nestloop off (như W1 test)|${await planExec(scope, lit(text, p), [], ["select set_config('enable_nestloop','off',true)"])}`,
          );
          console.log(`CR116-COLD|${name}|${tag}|${await coldWarm(scope, text, p)}`);
        }
        console.log(
          `CR116-PLAN|list|${tag}|param|${await planExec(scope, list.text, list.params)}`,
        );
        console.log(`CR116-COLD|list|${tag}|${await coldWarm(scope, list.text, list.params)}`);
      }
  }, 900_000);

  it("(2) total: đếm chính xác vs trần 1.000+ vs có-trang-sau vs ước lượng vs bảng đếm", async () => {
    let ok = true;
    for (const t of B.T) for (const who of [t.V, t.O]) ok = (await totalCase(t, who)) && ok;
    expect(ok).toBe(true);
  }, 1_200_000);

  it("(3) tìm: `($q is null or like)` vs tách nhánh `like` ± GIN pg_trgm", async () => {
    let ok = true;
    const TRGM = [
      "create extension if not exists pg_trgm",
      "create index cr116_trgm on contracts.contracts using gin (search_key gin_trgm_ops)",
      "analyze contracts.contracts",
    ];
    for (const t of B.T)
      for (const q of ["%777%", "%hd 1%"]) {
        const [scope, list] = (await B.capture(t.id, t.O, { ...filter, like: q })).queries as [
          Cap,
          Cap,
        ];
        const split = list.text.replace(
          /\((\$\d+)::text is null or c\.search_key like (\$\d+)::text\)/,
          "($1::text is not null and c.search_key like $2::text)",
        );
        if (split === list.text) throw new Error("không tìm thấy vị từ like");
        ok =
          (await B.compare(
            `C5b search q=${q} (O)`,
            t.n,
            scope,
            [
              v("A hiện tại (is null or like)", list),
              v("B tách nhánh, không index", list, split),
              v("C tách nhánh + GIN trgm", list, split, TRGM),
              v("D hiện tại + GIN trgm", list, list.text, TRGM),
            ],
            listKey,
            { explainOf: t.n > 10_000 ? [2] : [] },
          )) && ok;
      }
    expect(ok).toBe(true);
  }, 1_200_000);

  it("(4) kế hoạch: plan_cache_mode auto (hiện tại) vs force_generic_plan cho câu list", async () => {
    let ok = true;
    for (const t of B.T)
      for (const who of [t.V, t.O]) {
        const [scope, list] = (await B.capture(t.id, who, filter)).queries as [Cap, Cap];
        ok =
          (await B.compare(
            `C8 plan cache (${who === t.V ? "V" : "O"})`,
            t.n,
            scope,
            [
              v("A auto (hiện tại)", list),
              v("B force_generic_plan", list, list.text, [
                "set local plan_cache_mode = force_generic_plan",
              ]),
            ],
            listKey,
          )) && ok;
      }
    expect(ok).toBe(true);
  }, 900_000);

  it("(6) Bun.sql vs postgres.js: list/detail cùng câu; cắt kết nối giữa tx", async () => {
    const t = B.T[1] as Ten;
    const [scope, list] = (await B.capture(t.id, t.V, filter)).queries as [Cap, Cap];
    const url = urls().owner;
    const pg = openOwner(1);
    const bun = new Bun.SQL(url, { max: 1 });
    const drivers: [
      string,
      (
        fn: (q: (s: string, p: unknown[]) => Promise<unknown>) => Promise<unknown>,
      ) => Promise<unknown>,
    ][] = [
      // Bun.SQL trước: postgres.js 3.4.9 sập `socket.write` khi bị cắt kết nối giữa tx (đo vòng trước).
      ["Bun.SQL", (fn) => bun.begin((tx) => fn((s, p) => tx.unsafe(s, p as never[])))],
      ["postgres.js 3.4.9", (fn) => pg.begin((tx) => fn((s, p) => tx.unsafe(s, p as never[])))],
    ];
    const keys: string[] = [];
    for (const [name, run] of drivers) {
      const ms: number[] = [];
      let out: unknown;
      for (let r = 0; r < 3; r++)
        await run(async (q) => {
          await q(scope.text, scope.params);
          for (let i = 0; i < 5; i++) await q(list.text, list.params);
          for (let i = 0; i < 60; i++) {
            const t0 = performance.now();
            out = await q(list.text, list.params);
            ms.push(performance.now() - t0);
          }
        });
      keys.push(listKey(out));
      const st = latencyStats(ms);
      console.log(
        `CR116|C7 driver list (V)|${name}|${t.n}|${st.p50.toFixed(2)}|${st.p95.toFixed(2)}|2|${keys[0] === keys.at(-1) ? "✓" : "✗"}|-|conn=1`,
      );
      // Cắt kết nối giữa tx: lỗi phải trả về (không treo/không crash tiến trình), lần sau dùng lại được.
      let err = "không lỗi";
      try {
        await run(async (q) => {
          await q("select pg_terminate_backend(pg_backend_pid())", []); // trước khi đổi role (role gói không được kết thúc tiến trình)
          await q("select 1", []);
        });
      } catch (e) {
        err = String((e as Error).message).slice(0, 80);
      }
      let after = "ok";
      try {
        await run((q) => q("select 1", []));
      } catch (e) {
        after = `lỗi: ${String((e as Error).message).slice(0, 60)}`;
      }
      console.log(`CR116-KILL|${name}|err=${err}|sau đó=${after}`);
    }
    await pg.end({ timeout: 1 }).catch(() => {});
    await bun.close().catch(() => {});
    expect(keys[0]).toBe(keys[1]);
  }, 600_000);
});
