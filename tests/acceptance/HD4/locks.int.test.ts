// HD4 review M1 · CR-127 K6: hàng lịch mồ côi ⇒ lô dọn. Các ca cũ (khoá HĐ ↔ PATCH `end_date` đổi hạn; chạy đua lô ∥ PATCH ∥ "mở lại";
// thông báo ≤ 1 mỗi mốc) đã XOÁ có chủ ý: "mở lại", `action_deadline` và thông báo hạn chót đã gỡ (spec §11); khoá `FOR NO KEY UPDATE
// … SKIP LOCKED` của `claim` vẫn do hub-api int (expiry-outcome/remind) và perf lô kiểm.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { setupX2a } from "../X2a/_x2a";
import {
  addContract,
  needHd4,
  type Rem,
  resetHd4,
  type Sql,
  startReminders,
  T,
} from "./_support/hd4";

let sql: Sql;
const rems: Rem[] = [];
beforeAll(async () => {
  sql = await setupX2a();
});
afterAll(async () => {
  for (const r of rems) await r.stop();
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

describe("HD4 review M1 · thứ tự khoá HĐ → lịch", () => {
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
