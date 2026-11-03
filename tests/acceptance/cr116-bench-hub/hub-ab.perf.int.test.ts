// CR-116 · bench hub (CHỈ ĐO, không đổi hành vi): A/B trực tiếp các ứng viên chọn từ pg_stat_statements (report.md §1).
// Mỗi ứng viên: biến thể hiện tại (văn bản SQL như code) vs 1–3 biến thể thay thế trên CÙNG dữ liệu seed (bản sao bảng Hub
// trong schema `bench`, giữ kiểu + index thật), cỡ nhỏ (~100 hàng, như prod) và lớn (10k–100k); kết quả phải bằng nhau.
// In `[ab] …` (p50/p95/tổng/số câu SQL/bằng nhau) + `[explain] …` + `[rel] …` (độ tin cậy) + `[res] …` (tài nguyên). Chỉ PERF=1.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { SQL } from "bun";
import postgres from "postgres";
import { ab, explain } from "./_ab";
import { cloneTable, fill, uid, uidSql } from "./_seed";

const PERF = process.env.PERF === "1";
const T = uid(0x7e, 1);
const T2 = uid(0x7e, 2);
let sql: Sql;
let raw: Sql; // postgres.js prepare:false (biến thể "không prepared")
let bun: SQL; // Bun.sql native
const ACTIVE = "('running', 'waiting_review', 'waiting_answer', 'needs_decision')";

beforeAll(async () => {
  if (!PERF) return;
  await cloneDb("full");
  sql = openOwner(4);
  raw = postgres(urls().owner, { max: 1, prepare: false, onnotice: () => {} });
  bun = new SQL(urls().owner, { max: 1 });
}, 300_000);
afterAll(async () => {
  await sql?.end();
  await raw?.end();
  await bun?.close();
});

/** Tài nguyên phía client của `fn`: CPU ms (user+system) + RSS tăng MiB; phía PG: buffers qua EXPLAIN in riêng. */
async function res(tag: string, fn: () => Promise<unknown>): Promise<void> {
  const c0 = process.cpuUsage();
  const r0 = process.memoryUsage().rss;
  const t0 = performance.now();
  await fn();
  const c = process.cpuUsage(c0);
  console.log(
    `[res] ${tag} | wall=${(performance.now() - t0).toFixed(1)}ms | cpu=${((c.user + c.system) / 1000).toFixed(1)}ms | rss+=${((process.memoryUsage().rss - r0) / 2 ** 20).toFixed(1)}MiB`,
  );
}

// ---------------- B1 · launcher-session isContinuing (pgss #6: 2.317 lần, 1.487 buffers/lần) ----------------
const isContinuingSql = (rt: string, ru: string) => `select exists (
      select 1 from bench.${rt} t where t.stage_run_id = $1 and t.tenant_id = $2
        and t.kind = 'ask' and t.result = 'answer'
        and t.decided_at > coalesce((select max(r.started_at) from bench.${ru} r
          where r.stage_run_id = $1 and r.tenant_id = $2), '-infinity')
    ) as ok`;

async function seedB1(n: number): Promise<number> {
  const stages = Math.max(1, Math.floor(n / 2));
  for (const [name, src, extra] of [
    ["rt0", "hub.review_tasks", []],
    ["rt1", "hub.review_tasks", ["create index on bench.rt1 (stage_run_id, tenant_id)"]],
    [
      "rt2",
      "hub.review_tasks",
      [
        "create index on bench.rt2 (stage_run_id, tenant_id, decided_at) where kind = 'ask' and result = 'answer'",
      ],
    ],
    ["ru0", "hub.runs", []],
    ["ru1", "hub.runs", ["create index on bench.ru1 (stage_run_id, tenant_id, started_at)"]],
  ] as [string, string, string[]][])
    await cloneTable(sql, src, name, extra);
  const st = uidSql(0xb1, `(i % ${stages}) + 1`);
  for (const t of ["rt0", "rt1", "rt2"])
    await fill(sql, t, n, {
      id: "gen_random_uuid()",
      tenant_id: `'${T}'::uuid`,
      stage_run_id: st,
      kind: "case when i % 2 = 0 then 'ask' else 'review' end",
      result: "case when i % 3 = 0 then 'answer' else null end",
      status: "'done'",
      decided_at: "now() - (i % 97) * interval '1 minute'",
    });
  for (const t of ["ru0", "ru1"])
    await fill(sql, t, n, {
      id: "gen_random_uuid()",
      tenant_id: `'${T}'::uuid`,
      stage_run_id: st,
      started_at: "now() - (i % 53) * interval '1 minute'",
      flow_id: "gen_random_uuid()",
    });
  return stages;
}

describe.skipIf(!PERF)("B1 · isContinuing (review_tasks/runs theo stage_run_id)", () => {
  for (const n of [100, 100_000])
    it(`B1 · ${n} hàng`, async () => {
      const stages = await seedB1(n);
      const p = (i: number) => [uid(0xb1, (Math.abs(i * 7919) % stages) + 1), T];
      const q = (rt: string, ru: string) => async (s: Sql, i: number) =>
        (await s.unsafe(isContinuingSql(rt, ru), p(i)))[0]?.ok as boolean;
      const rows = await ab(sql, {
        cand: "B1 isContinuing",
        rows: n,
        variants: [
          { name: "hiện tại (không index stage_run_id)", run: q("rt0", "ru0") },
          { name: "+index (stage_run_id,tenant_id) cả 2 bảng", run: q("rt1", "ru1") },
          { name: "+index một phần ask/answer + runs(stage,started_at)", run: q("rt2", "ru1") },
        ],
      });
      if (n > 1000) {
        const lit = (rt: string, ru: string) =>
          isContinuingSql(rt, ru)
            .replaceAll("$1", `'${uid(0xb1, 7)}'`)
            .replaceAll("$2", `'${T}'`);
        await explain(sql, "B1", "hiện tại", lit("rt0", "ru0"));
        await explain(sql, "B1", "+index", lit("rt1", "ru1"));
      }
      expect(rows.every((r) => r.equal)).toBe(true);
    }, 600_000);
});

// ---------------- B2 · activeAndCap (pgss #13: 7,4 ms/lần, 6.567 buffers/lần) ----------------
const capSql = (pr: string) => `select
      (select count(*)::int from bench.${pr} where tenant_id = $1 and status in ${ACTIVE}
        and pack_key is null) as n,
      (select process_runs_max from admin.tenants where id = $2) as max`;

async function seedRuns(n: number, names: [string, string[]][]): Promise<void> {
  for (const [name, extra] of names) {
    await cloneTable(sql, "hub.process_runs", name, extra);
    for (const [t, k] of [
      [T, 0],
      [T2, 1],
    ] as const)
      await fill(sql, name, n, {
        id: uidSql(0xb2 + k, "i"),
        tenant_id: `'${t}'::uuid`,
        status:
          "(array['running','waiting_review','waiting_answer','needs_decision','done','cancelled'])[(i % 6) + 1]",
        pack_key: "case when i % 10 = 0 then 'contracts' else null end",
        flow_id: "gen_random_uuid()",
        started_by: uidSql(0xb3, "(i % 50) + 1"),
        snapshot: `jsonb_build_object('def_sources', '[]'::jsonb, 'stages', (select jsonb_agg(jsonb_build_object('key','s'||g,'name','Bước '||g,'agent','a','sources','[]'::jsonb,'prompt', repeat('x', 300))) from generate_series(1, 10) g))`,
        input: "'HS-' || i",
      });
  }
}

describe.skipIf(!PERF)("B2 · activeAndCap (đếm run đang chạy của tenant)", () => {
  for (const n of [100, 50_000])
    it(`B2 · ${n} run/tenant`, async () => {
      await seedRuns(n, [
        ["pr0", []],
        [
          "pr1",
          [`create index on bench.pr1 (tenant_id) where status in ${ACTIVE} and pack_key is null`],
        ],
      ]);
      const q = (pr: string) => async (s: Sql) => (await s.unsafe(capSql(pr), [T, T]))[0];
      const rows = await ab(sql, {
        cand: "B2 activeAndCap",
        rows: n,
        variants: [
          { name: "hiện tại (index một phần status, lọc pack_key ở heap)", run: q("pr0") },
          { name: "+index một phần status AND pack_key is null (index-only)", run: q("pr1") },
        ],
      });
      if (n > 1000) {
        const lit = (pr: string) =>
          capSql(pr).replaceAll("$1", `'${T}'`).replaceAll("$2", `'${T}'`);
        await explain(sql, "B2", "hiện tại", lit("pr0"));
        await explain(sql, "B2", "+index pack_key", lit("pr1"));
      }
      expect(rows.every((r) => r.equal)).toBe(true);
    }, 600_000);
});

// ---------------- B5 · đọc đầu run lặp (pgss top calls #2/#4/#9: 3 câu PK cùng hàng mỗi bước) ----------------
const HEAD_QS = [
  "select tenant_id, started_by, status, current_stage_idx, input, snapshot from bench.pr0 where id = $1",
  "select coalesce(snapshot->'def_sources', '[]'::jsonb) as def_sources, coalesce(snapshot->'stages'->($2::int)->'sources', '[]'::jsonb) as stage_sources, pinned_sources as pinned from bench.pr0 where id = $1",
  "select tenant_id, started_by, status, current_stage_idx, conversation_id, input, snapshot, pinned_sources, inputs from bench.pr0 where id = $1",
];
const HEAD_ONE =
  "select tenant_id, started_by, status, current_stage_idx, conversation_id, input, snapshot, pinned_sources, inputs, coalesce(snapshot->'def_sources', '[]'::jsonb) as def_sources, coalesce(snapshot->'stages'->($2::int)->'sources', '[]'::jsonb) as stage_sources from bench.pr0 where id = $1";

describe.skipIf(!PERF)(
  "B5 · đọc đầu run: 3 câu PK vs 1 câu; postgres.js prepared/unprepared; Bun.sql",
  () => {
    for (const n of [100, 10_000])
      it(`B5 · ${n} run`, async () => {
        await seedRuns(n, [["pr0", []]]);
        const id = (i: number) => uid(0xb2, (Math.abs(i * 7919) % n) + 1);
        const canon = (r: Record<string, unknown>) => ({
          st: r.status,
          idx: r.current_stage_idx,
          snap: JSON.stringify(r.snapshot).length,
          ds: JSON.stringify(r.def_sources),
        });
        const three = async (s: Sql, i: number) => {
          const a = (await s.unsafe(HEAD_QS[0] as string, [id(i)]))[0] as Record<string, unknown>;
          const b = (await s.unsafe(HEAD_QS[1] as string, [id(i), 1]))[0] as Record<
            string,
            unknown
          >;
          await s.unsafe(HEAD_QS[2] as string, [id(i)]);
          return { ...a, def_sources: b.def_sources };
        };
        const rows = await ab(sql, {
          cand: "B5 đọc đầu run",
          rows: n,
          canon: canon as (r: unknown) => unknown,
          variants: [
            { name: "hiện tại: 3 câu PK (prepared)", run: three },
            { name: "3 câu PK, prepare:false", run: (_s, i) => three(raw, i) },
            {
              name: "1 câu gộp (prepared)",
              run: async (s, i) =>
                (await s.unsafe(HEAD_ONE, [id(i), 1]))[0] as Record<string, unknown>,
            },
            {
              name: "3 câu PK qua Bun.sql native",
              run: async (_s, i) => {
                const a = (await bun.unsafe(HEAD_QS[0] as string, [id(i)]))[0];
                const b = (await bun.unsafe(HEAD_QS[1] as string, [id(i), 1]))[0];
                await bun.unsafe(HEAD_QS[2] as string, [id(i)]);
                return { ...a, def_sources: b.def_sources };
              },
            },
          ],
          n: 200,
          warm: 20,
        });
        await res(`B5 ${n} 3 câu × 500`, async () => {
          for (let i = 0; i < 500; i++) await three(sql, i);
        });
        await res(`B5 ${n} 1 câu × 500`, async () => {
          for (let i = 0; i < 500; i++) await sql.unsafe(HEAD_ONE, [id(i), 1]);
        });
        expect(rows.every((r) => r.equal)).toBe(true);
      }, 600_000);
  },
);
