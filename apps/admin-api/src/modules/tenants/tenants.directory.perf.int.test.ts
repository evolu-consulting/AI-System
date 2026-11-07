// CR-124 · q2 · NFR-03 · Luật 4c · tìm danh bạ MỘT câu SQL: 20.000 công ty đã bật, p95 ≤ 20 ms (MST đúng và tên trigram).
// In số thật. Chạy: PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test <file>.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { ADMIN_API_URL, createEnv, type Env } from "../../../../../tests/acceptance/M1/_fixtures";

const N = 20_000;
const RUNS = 300;
const P95_MS = 20;
let env: Env;
let api: postgres.Sql;

const p = (xs: number[], q: number) =>
  [...xs].sort((a, b) => a - b)[Math.ceil((q / 100) * xs.length) - 1] ?? 0;

async function time(term: string): Promise<{ ms: number[]; rows: number }> {
  const ms: number[] = [];
  let rows = 0;
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    rows = await api.begin(async (tx) => {
      await tx`select set_config('app.scope', 'tenant', true), set_config('app.tenant_id', ${"00000000-0000-7000-8000-000000000001"}, true)`;
      return (await tx`select * from admin.directory_search(${term})`).length;
    });
    ms.push(performance.now() - s);
  }
  return { ms, rows };
}

beforeAll(async () => {
  env = await createEnv({ fixture: false });
  await env.owner`insert into admin.tenants (key, name, legal_name, tax_code, address, directory_listed)
    select 'perf-' || g, 'Perf ' || g, 'Công ty ' || substr(md5(g::text), 1, 12) || ' ' || g,
           lpad(g::text, 10, '0'), g || ' Đường số 1', true
      from generate_series(1, ${N}) g`;
  await env.owner`analyze admin.tenants`;
  api = postgres(ADMIN_API_URL, { max: 1, onnotice: () => {} });
}, 180_000);
afterAll(async () => {
  await api?.end({ timeout: 2 });
  await env?.close();
});

describe("CR-124 q2 · NFR-03 perf danh bạ", () => {
  it("20000 công ty: tìm MST đúng p95 ≤ 20 ms", async () => {
    await time("0000012345"); // làm nóng
    const { ms, rows } = await time("0000012345");
    const [p50, p95] = [p(ms, 50), p(ms, 95)];
    console.log(
      `perf directory MST: ${N} công ty, ${RUNS} lần: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, ${rows} dòng`,
    );
    expect(rows).toBe(1);
    expect(p95).toBeLessThanOrEqual(P95_MS);
  });

  it("20000 công ty: tìm theo tên (trigram) p95 ≤ 20 ms", async () => {
    const [r] = await env.owner<{ n: string }[]>`select substr(md5('777'), 1, 6) as n`;
    const term = r?.n ?? "abcdef";
    await time(term);
    const { ms, rows } = await time(term);
    const [p50, p95] = [p(ms, 50), p(ms, 95)];
    const [ix] =
      await env.owner`select count(*)::int as n from pg_indexes where indexname = 'tenants_directory_name_trgm_idx'`;
    console.log(
      `perf directory tên: ${N} công ty, ${RUNS} lần: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, ${rows} dòng, trigram index=${ix?.n}`,
    );
    expect(rows).toBeGreaterThanOrEqual(1);
    expect(rows).toBeLessThanOrEqual(20);
    expect(p95).toBeLessThanOrEqual(P95_MS);
  });
});
