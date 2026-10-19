// HD4-NFR-01 · HD4-AC07 · Luật 4c (không thuộc Lệnh xong; `PERF=1 bun --config=bunfig.perf.toml test tests/acceptance/HD4/perf/`):
// 10.000 HĐ tới hạn (acme) + 10.000 nền (beta, chưa duyệt), lô 100. Mỗi lô (tìm tenant + claim + áp dụng/nhắc/notify) p95 ≤ 50 ms;
// số câu SQL mỗi lô cố định; không Seq Scan `contracts` ở câu tìm tenant và claim. Đo trước và sau ANALYZE. Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { asRole } from "@ai/test-kit/db";
import { latencyStats, seqScansOf } from "@ai/test-kit/perf";
import { setupX2a } from "../../X2a/_x2a";
import {
  JOB_ROLE,
  needHd4,
  P,
  type Rem,
  resetHd4,
  type Sql,
  startReminders,
  T,
} from "../_support/hd4";

const TOTAL = 10_000;
const BATCH = 100;
const THRESHOLD_MS = 50;
const AT = "2026-10-01T03:00:00Z"; // 10:00 VN

let sql: Sql;
let rem: Rem;
beforeAll(async () => {
  sql = await setupX2a();
  rem = startReminders({ at: AT, pool: 4 });
});
afterAll(async () => {
  await sql`alter table contracts.contracts reset (autovacuum_enabled)`.catch(() => {});
  await rem?.stop();
  await sql?.end();
});

/** INSERT…SELECT một câu: acme 10.000 HĐ đã duyệt, hạn còn 1…50 ngày (mỗi HĐ đúng một mốc tới); beta 10.000 needs_review. */
async function seed(): Promise<number> {
  await needHd4(sql);
  await resetHd4(sql);
  await sql`alter table contracts.contracts set (autovacuum_enabled = false)`;
  const t0 = performance.now();
  for (const [tenant, status, owner] of [
    [T.acme, "active", P.lan.id],
    [T.beta, "needs_review", P.an.id],
  ] as const)
    await sql`insert into contracts.contracts (tenant_id, title, status, owner_user_id, created_by, fields)
      select ${tenant}, 'HĐ perf ' || g, ${status}, ${owner}, ${owner}, jsonb_build_object(
        'number', jsonb_build_object('value', 'P-' || g),
        'supplier_name', jsonb_build_object('value', 'Công ty A'), 'buyer_name', jsonb_build_object('value', 'Công ty B'),
        'end_date', jsonb_build_object('value', to_char(date '2026-10-02' + (g % 50), 'YYYY-MM-DD')),
        'notice_days', jsonb_build_object('value', 0), 'total_value', jsonb_build_object('value', 1000000))
      from generate_series(1, ${TOTAL}::int) g`;
  return performance.now() - t0;
}

async function phase(name: string): Promise<void> {
  const seedMs = await seed();
  if (name.includes("sau")) await sql`analyze contracts.contracts`;
  rem.clock.set(new Date(AT));
  const ms: number[] = [];
  const perBatch: number[] = [];
  let first: Awaited<ReturnType<Rem["count"]>> | undefined;
  const t0 = performance.now();
  for (;;) {
    const s = performance.now();
    const c = await rem.count(() => rem.r.once());
    if (c.r === null) break;
    ms.push(performance.now() - s);
    perBatch.push(c.n);
    first ??= c;
    expect(c.r.claimed).toBeLessThanOrEqual(BATCH);
  }
  const wall = performance.now() - t0;
  const st = latencyStats(ms);
  const [n] = await sql<{ notes: number; rems: number; due: number }[]>`select
    (select count(*)::int from hub.notifications where source = 'contracts') as notes,
    (select count(*)::int from contracts.contract_reminders) as rems,
    (select count(*)::int from contracts.contract_schedule where remind_at <= ${AT}) as due`;
  // EXPLAIN câu tìm tenant (role job) và claim (role rw + tenant) của lô đầu, với hằng thật.
  const caps = first?.caps ?? [];
  const find = caps.find((c) => /order by remind_at/i.test(c.text) && /limit 1/i.test(c.text));
  const claim = caps.find((c) => /skip locked/i.test(c.text));
  const seqFind = find
    ? await seqScansOf((f) => asRole(JOB_ROLE, null, f, { rollback: true }), find, [
        "contracts",
        "contract_schedule",
      ])
    : ["?"];
  const seqClaim = claim
    ? await seqScansOf((f) => asRole("contracts_rw", T.acme, f, { rollback: true }), claim, [
        "contracts",
      ])
    : ["?"];
  console.log(
    `HD4-NFR-01 · ${name} · seed ${(seedMs / 1000).toFixed(1)} s · lô ${BATCH}: p50=${st.p50.toFixed(2)} p95=${st.p95.toFixed(2)} max=${st.max.toFixed(2)} ms (n=${st.n}, ngưỡng ${THRESHOLD_MS}) · câu/lô=${[...new Set(perBatch)].join(",")} · 10.000 xong ${(wall / 1000).toFixed(2)} s · thông báo ${n?.notes} · Seq Scan tìm=${seqFind.join(",") || "0"} claim=${seqClaim.join(",") || "0"}`,
  );
  expect({ batches: ms.length, notes: n?.notes, rems: n?.rems, due: n?.due }).toEqual({
    batches: TOTAL / BATCH,
    notes: TOTAL,
    rems: TOTAL,
    due: 0,
  });
  expect([...new Set(perBatch)]).toEqual([5]); // tìm tenant (set_config + select) + lô (set_config + claim + apply)
  expect({ seqFind, seqClaim }).toEqual({ seqFind: [], seqClaim: [] });
  expect(st.p95).toBeLessThanOrEqual(THRESHOLD_MS);
}

describe("HD4-NFR-01 · vòng nhắc lô 100 trên 10.000 HĐ tới hạn", () => {
  it("pha 1 — trước ANALYZE", () => phase("trước ANALYZE"), 600_000);
  it("pha 2 — sau ANALYZE", () => phase("sau ANALYZE"), 600_000);
});
