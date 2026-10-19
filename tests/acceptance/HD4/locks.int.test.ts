// HD4 review M1 · HD4-FR-04/05: thứ tự khoá vòng nhắc ↔ đường ghi HĐ. Vòng nhắc claim `FOR NO KEY UPDATE OF c, s SKIP LOCKED`
// (hàng HĐ trước, hàng lịch sau) — cùng thứ tự với PATCH / `POST /handled` / mở lại duyệt (khoá HĐ, rồi trigger AFTER ghi lịch).
// (1) HĐ đang bị người dùng giữ khoá ⇒ lô bỏ qua, không chờ; người dùng ghi xong (trigger đụng lịch) không 40P01.
// (2) Chạy đua lô ∥ lô ∥ PATCH ∥ mở lại nhiều vòng ⇒ không 40P01, không lỗi lô, mỗi HĐ ≤ 1 nhắc mỗi mốc.
// Không sleep: giữ khoá bằng promise hoãn, thả bằng tín hiệu.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { rolePool } from "@ai/test-kit/db";
import { setupX2a } from "../X2a/_x2a";
import {
  addContract,
  needHd4,
  notes,
  type Rem,
  resetHd4,
  rowOf,
  type Sql,
  startReminders,
  T,
} from "./_support/hd4";

let sql: Sql;
let pool: ReturnType<typeof rolePool>;
const rems: Rem[] = [];
beforeAll(async () => {
  sql = await setupX2a();
  pool = rolePool(6);
});
afterAll(async () => {
  for (const r of rems) await r.stop();
  await pool?.close();
  await sql?.end();
});
beforeEach(async () => {
  await needHd4(sql);
  await resetHd4(sql);
});
const AT = "2026-10-01T03:00:00Z";
const start = (): Rem => {
  const r = startReminders({ at: AT });
  rems.push(r);
  return r;
};
const fv = (value: unknown) => ({ value, quote: "", verified: false, edited: true });
const asUser = <R>(fn: (tx: Sql) => Promise<R>) => pool.inPack("contracts", T.acme, fn);
/** PATCH-như HD1: khoá hàng HĐ rồi sửa `end_date` (trigger AFTER ghi lịch). */
const patchEnd = (id: string, end: string) =>
  asUser(async (tx) => {
    await tx`select id from contracts.contracts where id = ${id} for update`;
    await tx`update contracts.contracts set fields = fields || ${tx.json({ end_date: fv(end) } as never)}, version = version + 1
      where id = ${id}`;
  });
/** Mở lại duyệt như HD3: khoá hàng HĐ rồi đưa về `needs_review` (trigger AFTER xoá lịch). */
const reopen = (id: string) =>
  asUser(async (tx) => {
    await tx`select id from contracts.contracts where id = ${id} for update`;
    await tx`update contracts.contracts set status = 'needs_review', version = version + 1 where id = ${id}`;
  });
const code = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } })?.cause?.code ??
  (e as { code?: string })?.code;

describe("HD4 review M1 · thứ tự khoá HĐ → lịch", () => {
  it("HĐ đang bị giữ khoá ⇒ lô bỏ qua (không chờ); người giữ sửa hạn rồi commit không 40P01; lượt sau nhắc theo hạn mới", async () => {
    const held = await addContract(sql, { end: "2026-10-06", notice: 0 });
    const other = await addContract(sql, { end: "2026-10-06", notice: 0 });
    const r = start();
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    let locked!: () => void;
    const lockedSig = new Promise<void>((res) => {
      locked = res;
    });
    const user = asUser(async (tx) => {
      await tx`select id from contracts.contracts where id = ${held} for update`;
      locked();
      await gate;
      await tx`update contracts.contracts set fields = fields || ${tx.json({ end_date: fv("2026-10-20") } as never)}
        where id = ${held}`;
    });
    await lockedSig;
    const b = await r.r.once(); // phải trả ngay: hàng `held` bị SKIP LOCKED
    expect({ claimed: b?.claimed, notes: (await notes(sql)).map((n) => n.link) }).toEqual({
      claimed: 1,
      notes: [`/contracts/${other}`],
    });
    release();
    await user; // không 40P01
    expect((await rowOf(sql, held)).due).toBe("-infinity");
    await r.r.once();
    expect((await notes(sql)).map((n) => n.dedup_key)).toContain(`remind:${held}:2026-10-20:30`);
  });

  it("chạy đua 12 vòng: 2 lô ∥ PATCH ∥ mở lại ⇒ 0 lỗi 40P01, 0 lô hỏng, mỗi (HĐ, hạn, mốc) ≤ 1 thông báo", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 24; i++) ids.push(await addContract(sql, { end: "2026-10-06", notice: 0 }));
    const r1 = start();
    const r2 = start();
    const errors: string[] = [];
    let failed = 0;
    const guard = (p: Promise<unknown>) => p.catch((e) => errors.push(code(e) ?? String(e)));
    for (let round = 0; round < 12; round++) {
      await sql`update contracts.contracts set status = 'active' where id = any(${ids}::uuid[])`;
      await sql`insert into contracts.contract_schedule (contract_id, tenant_id, remind_at)
        select id, tenant_id, '-infinity' from contracts.contracts where id = any(${ids}::uuid[])
        on conflict (contract_id) do update set remind_at = '-infinity'`;
      const a = ids[(round * 5) % ids.length] as string;
      const b = ids[(round * 7 + 3) % ids.length] as string;
      await Promise.all([
        guard(r1.r.drain().then((t) => (failed += t.failed))),
        guard(r2.r.drain().then((t) => (failed += t.failed))),
        guard(patchEnd(a, `2026-10-${String(10 + (round % 15)).padStart(2, "0")}`)),
        guard(reopen(b)),
      ]);
    }
    expect({ errors, failed }).toEqual({ errors: [], failed: 0 });
    const [d] = await sql<{ n: number; distinct: number }[]>`select count(*)::int as n,
      count(distinct dedup_key)::int as distinct from hub.notifications where source = 'contracts'`;
    expect(d?.n).toBe(d?.distinct);
  });

  it("review m1 · hàng lịch mồ côi (HĐ mất, trigger không chạy) ⇒ lô dọn, tìm tenant không còn trả tenant đó", async () => {
    const id = await addContract(sql, { end: "2026-10-06", notice: 0 });
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`; // trigger không chạy ⇒ lịch thành mồ côi
      await tx`delete from contracts.contracts where id = ${id}`;
    });
    const [o] = await sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.contract_schedule where contract_id = ${id}`;
    expect(o?.n).toBe(1);
    const r = start();
    expect((await r.r.once())?.claimed).toBe(0);
    expect(await r.r.once()).toBeNull();
  });
});
