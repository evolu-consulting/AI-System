// CR-097 D1 · backfill dữ liệu khách (`tools/scripts/src/d1-backfill.ts`): (1) chạy 2 lần ra cùng kết quả (lần 2 = 0 hàng đổi),
// (2) KHÔNG chạm tenant khác, (3) sao đã nhập giữ nguyên, (4) --dry-run không ghi gì. VIẾT, CHƯA CHẠY (Luật 0b: int chạy cuối đợt).
// Hạ tầng: HD1/HD7 (Postgres thật, vai chủ migration ở `c.sql`; acme + beta).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { backfill } from "../../../tools/scripts/src/d1-backfill";
import { startHd1 } from "../HD1/_support/hd1";
import { type CtxN1, deal, T } from "../HD7/_support/hd7";

let c: CtxN1;
let acme = "";
let beta = "";

beforeAll(async () => {
  c = await startHd1();
  // Dựng hai HĐ đã xác nhận (acme, beta) rồi GỠ khoá K1 để có hàng "thiếu locked_at" (trigger K1 luôn lấp khi ghi bình thường).
  acme = await deal(c.sql, { tenant: T.acme });
  beta = await deal(c.sql, { tenant: T.beta });
  await c.sql.unsafe("alter table contracts.contracts disable trigger contracts_k1_lock");
  try {
    await c.sql`update contracts.contracts set locked_at = null, locked_by = null where id = any(${[acme, beta]}::uuid[])`;
  } finally {
    await c.sql.unsafe("alter table contracts.contracts enable trigger contracts_k1_lock");
  }
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const lockedAt = async (id: string) =>
  (
    await c.sql<
      { l: string | null }[]
    >`select locked_at::text as l from contracts.contracts where id = ${id}`
  )[0]?.l ?? null;
const ratings = async (t: string) =>
  (
    await c.sql<
      { n: number }[]
    >`select (select count(*) from contracts.score_ratings where tenant_id = ${t})::int
    + (select count(*) from contracts.partner_events where tenant_id = ${t} and type = 'rating')::int as n`
  )[0]?.n ?? -1;

describe("D1 backfill", () => {
  it("--dry-run: báo số hàng sẽ đổi nhưng KHÔNG ghi", async () => {
    const r = await backfill(c.sql, T.acme, "acme", true);
    expect(r.changed.locked).toBeGreaterThanOrEqual(1);
    expect(await lockedAt(acme)).toBeNull();
  });

  it("chạy thật 2 lần: lần 1 khoá hàng thiếu, lần 2 = 0 hàng đổi; tenant khác không bị chạm; sao giữ nguyên", async () => {
    const stars = await ratings(T.acme);
    const first = await backfill(c.sql, T.acme, "acme", false);
    expect(first.changed.locked).toBeGreaterThanOrEqual(1);
    expect(await lockedAt(acme)).not.toBeNull();
    // beta chưa chạy backfill ⇒ vẫn thiếu (không bị chạm bởi lần chạy của acme)
    expect(await lockedAt(beta)).toBeNull();

    const second = await backfill(c.sql, T.acme, "acme", false);
    expect(second.changed).toEqual({ root: 0, version: 0, locked: 0 });
    expect(second.after).toEqual(first.after);
    expect(await ratings(T.acme)).toBe(stars);
  });
});
