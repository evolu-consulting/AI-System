// HD-NFR-02 · HD-NFR-03 · HD-AC14 · Luật 4c · plan §6: chi tiết p95 ≤ 30 ms (2 câu) · PATCH p95 ≤ 30 ms (4 câu, 1 tx) · tải lên 3 câu SQL +
// 1 pipeline Redis, p95 ≤ 30 ms — trên 3 tenant × 10.000 HĐ + 70.000 nền. Đo trước và sau ANALYZE. Làm nóng = pool + 2 (D2-48).
// Chỉ chạy trong `PERF=1 bun --config=bunfig.perf.toml test tests/acceptance/HD1/perf/`. Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CBASE,
  type CtxN1,
  clearQuota,
  countHops,
  ensureRoles,
  getWith,
  insFile,
  jsonWith,
  measure,
  needContracts,
  P,
  PERF_N,
  pdf,
  redisOps,
  startHd1,
  T,
  upload,
  warmRounds,
} from "../_support/hd1";
import { analyzeAll, restoreAutovacuum, seedPerf } from "../_support/seed";

let c: CtxN1;
let tokR = "";
let tokW = "";
let ids: string[] = [];
let ready: Promise<void> | undefined;
const SLOT = 64; // ≥ số lượt làm nóng
const W = SLOT + PERF_N + 10; // một cửa sổ id (làm nóng + đo + dư)
function prepare(): Promise<void> {
  ready ??= (async () => {
    await needContracts(c.sql);
    await ensureRoles(c);
    const s = await seedPerf(c.sql);
    console.log(
      `HD1 seed perf (rw): ${s.rows.contracts} HĐ + ${s.rows.items} item + ${s.rows.events} event trong ${(s.ms / 1000).toFixed(1)} s`,
    );
    tokR = await c.tok(P.tam);
    tokW = await c.tok(P.hoa);
    ids = (
      await c.sql<
        { id: string }[]
      >`select id from contracts.contracts where tenant_id = ${T.acme} and kind = 'contract' order by id limit ${4 * W}`
    ).map((r) => r.id);
    expect(ids.length).toBe(4 * W);
  })();
  return ready;
}
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  if (ready) await restoreAutovacuum(c.sql).catch(() => {});
  await c?.stop();
});
/** vị trí id cho lượt i (i < 0 = làm nóng) trong cửa sổ `base` của pha. */
const at = (base: number, i: number): string => ids[base + (i < 0 ? -i - 1 : SLOT + i)] as string;

function runPhase(phase: string, p: 0 | 1) {
  const dBase = p * 2 * W; // cửa sổ id riêng cho chi tiết / PATCH của từng pha (PATCH cần version 1)
  const pBase = dBase + W;
  it(`HD-NFR-02 · ${phase} · chi tiết p95 ≤ 30 ms, 2 câu SQL, 0 Redis, 0 HTTP nội bộ (5 item, 20 event)`, async () => {
    await prepare();
    const st = await measure(c, () => getWith(c, tokR, `${CBASE}/${at(dBase, 0)}`));
    let k = 0;
    const st2 = await measure(c, () => getWith(c, tokR, `${CBASE}/${at(dBase, k++ % PERF_N)}`));
    const h = await countHops(c, () => getWith(c, tokR, `${CBASE}/${at(dBase, 3)}`));
    console.log(
      `HD-NFR-02 · ${phase} · chi tiết (id lặp) p95=${st.p95.toFixed(2)} · chi tiết (id đổi) p50=${st2.p50.toFixed(2)} p95=${st2.p95.toFixed(2)} max=${st2.max.toFixed(1)} ms (n=${st2.n}, ngưỡng 30) · SQL=${h.sql}`,
    );
    expect({
      status: h.r.status,
      sql: h.sql,
      http: h.http,
      redis: h.redis,
      items: h.r.json?.items?.length,
      events: h.r.json?.events?.length,
    }).toEqual({
      status: 200,
      sql: 2,
      http: [],
      redis: [],
      items: 5,
      events: 20,
    });
    expect(st2.p95).toBeLessThanOrEqual(30);
  }, 300_000);

  it(`HD-NFR-02 · ${phase} · PATCH trường p95 ≤ 30 ms, đúng 4 câu SQL (1 tx), 0 Redis, 0 HTTP nội bộ`, async () => {
    await prepare();
    const patchAt = (i: number) =>
      jsonWith(c, tokW, "PATCH", `${CBASE}/${at(pBase, i)}/fields`, {
        version: 1,
        fields: { notice_days: 100 + (Math.abs(i) % 50) },
      });
    const st = await measure(c, patchAt, { n: PERF_N });
    const h = await countHops(c, () => patchAt(PERF_N + 1));
    console.log(
      `HD-NFR-02 · ${phase} · PATCH p50=${st.p50.toFixed(2)} p95=${st.p95.toFixed(2)} max=${st.max.toFixed(1)} ms (n=${st.n}, ngưỡng 30) · SQL=${h.sql}`,
    );
    expect({
      status: h.r.status,
      version: h.r.json?.version,
      sql: h.sql,
      http: h.http,
      redis: h.redis,
    }).toEqual({ status: 200, version: 2, sql: 4, http: [], redis: [] });
    expect(st.p95).toBeLessThanOrEqual(30);
  }, 300_000);

  it(`HD-NFR-02 · ${phase} · /source và /file p95 ≤ 30 ms, mỗi đường đúng 2 câu SQL, 0 Redis, 0 HTTP nội bộ (/file: 1 lời gọi FileBox)`, async () => {
    await prepare();
    const id = ids[dBase + W - 1] as string; // ô cuối cửa sổ: không dùng cho chi tiết (SLOT + PERF_N < W)
    const fid = c.fb.put(new TextEncoder().encode("%PDF-1.4 x"), "p.pdf", `t_${T.acme}`).file_id;
    const rowId = `f11e0000-0000-4000-8000-${String(p + 1).padStart(12, "0")}`;
    await insFile(c.sql, T.acme, rowId, fid);
    await c.sql`update contracts.contracts set file_id = ${rowId}, source_text = 'Văn bản nguồn HĐ' where id = ${id}`;
    const src = await measure(c, () => getWith(c, tokR, `${CBASE}/${id}/source`));
    const fil = await measure(c, () => getWith(c, tokR, `${CBASE}/${id}/file`), {
      okStatus: 302,
    });
    const hs = await countHops(c, () => getWith(c, tokR, `${CBASE}/${id}/source`));
    const hf = await countHops(c, () => getWith(c, tokR, `${CBASE}/${id}/file`), [c.fb.origin]);
    console.log(
      `HD-NFR-02 · ${phase} · /source p50=${src.p50.toFixed(2)} p95=${src.p95.toFixed(2)} max=${src.max.toFixed(1)} ms (n=${src.n}, ngưỡng 30) · SQL=${hs.sql} · /file p50=${fil.p50.toFixed(2)} p95=${fil.p95.toFixed(2)} max=${fil.max.toFixed(1)} ms (n=${fil.n}, ngưỡng 30) · SQL=${hf.sql}`,
    );
    expect({
      source: [hs.r.status, hs.sql, hs.redis, hs.http],
      file: [hf.r.status, hf.sql, hf.redis, hf.http, hf.httpExt.length],
    }).toEqual({ source: [200, 2, [], []], file: [302, 2, [], [], 1] });
    expect(Math.max(src.p95, fil.p95)).toBeLessThanOrEqual(30);
  }, 300_000);

  it(`HD-NFR-03 · ${phase} · tải lên PDF nhỏ p95 ≤ 30 ms (FileBox giả cùng máy), 3 câu SQL, đúng 1 pipeline Redis, 0 lệnh lẻ`, async () => {
    await prepare();
    // hạn mức 30/tenant/ngày: xoá bộ đếm Redis TRƯỚC mỗi lượt đo (ngoài đồng hồ) — chỉ đo đường tải lên, không đo chặn quota
    const reset = () => clearQuota(c.hub.redis);
    const n = Math.min(PERF_N, 100);
    const st = await measure(
      c,
      () => upload(c, P.hoa, { bytes: pdf(2_000), name: "do.pdf", token: tokW }),
      { n, okStatus: 201, before: reset },
    );
    await reset();
    const h = await countHops(
      c,
      () =>
        redisOps(c, () => upload(c, P.hoa, { bytes: pdf(2_000), name: "dem.pdf", token: tokW })),
      [c.fb.origin],
    );
    console.log(
      `HD-NFR-03 · ${phase} · tải lên p50=${st.p50.toFixed(2)} p95=${st.p95.toFixed(2)} max=${st.max.toFixed(1)} ms (n=${st.n}, ngưỡng 30) · SQL=${h.sql} · pipeline Redis=${h.r.pipelines.length}`,
    );
    expect({
      status: h.r.r.status,
      sql: h.sql,
      http: h.http,
      pipelines: h.r.pipelines.length,
      single: h.r.single,
    }).toEqual({ status: 201, sql: 3, http: [], pipelines: 1, single: [] });
    expect(st.p95).toBeLessThanOrEqual(30);
    expect(warmRounds(c.hub)).toBeGreaterThanOrEqual(3);
  }, 300_000);
}

describe("HD-NFR-02/03 · pha 1 — CHƯA ANALYZE", () => {
  it("HD-NFR-02 · tiền đề pha 1: contracts chưa có thống kê", async () => {
    await prepare();
    const [r] =
      await c.sql`select count(*)::int as n from pg_stats where schemaname = 'contracts' and tablename = 'contracts'`;
    expect(r?.n).toBe(0);
  });
  runPhase("trước ANALYZE", 0);
});
describe("HD-NFR-02/03 · pha 2 — sau ANALYZE", () => {
  it("HD-NFR-02 · ANALYZE", async () => {
    await prepare();
    await analyzeAll(c.sql);
    const [r] =
      await c.sql`select count(*)::int as n from pg_stats where schemaname = 'contracts' and tablename = 'contracts'`;
    expect(r?.n).toBeGreaterThan(0);
  }, 120_000);
  runPhase("sau ANALYZE", 1);
});
