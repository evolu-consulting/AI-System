// HD4-FR-02 · HD4-NFR-03 · CR-127 K6 (spec §2.1, §11): vòng nền chỉ còn TÍNH LẠI HIỆU LỰC (`effect`) theo ngày ở múi tenant
// (`refresh_effect`) — không còn `action_deadline`, `handled`, thông báo "hạn chót hành động" (chuyển sang outcome `contract.expiring`,
// test ở apps/hub-api expiry-outcome.int). Đồng hồ giả, gọi `once()`/`drain()` trực tiếp (Luật 4c: không sleep/poll).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { setupX2a } from "../X2a/_x2a";
import {
  addContract,
  needHd4,
  notes,
  type Rem,
  reminderRows,
  resetHd4,
  rowOf,
  type Sql,
  startReminders,
  T,
} from "./_support/hd4";

let sql: Sql;
let rem: Rem | undefined;
beforeAll(async () => {
  sql = await setupX2a();
});
afterAll(async () => {
  await rem?.stop();
  await sql?.end();
});
beforeEach(async () => {
  await needHd4(sql);
  await resetHd4(sql);
  await rem?.stop();
  rem = undefined;
});
const start = (at: string, o: { tz?: string } = {}): Rem => {
  rem = startReminders({ at, ...o });
  return rem;
};
/** Chạy vòng tới hết việc tại thời điểm `at` (đặt đồng hồ giả), trả `effect` của HĐ. */
const effectAt = async (r: Rem, at: string, id: string) => {
  r.clock.set(new Date(at));
  await r.r.drain();
  return (await rowOf(sql, id)).effect;
};
const mark = (id: string) =>
  sql`update contracts.contract_schedule set remind_at = '-infinity' where contract_id = ${id}`;

describe("HD4-FR-02 · HD4-AC02 · hiệu lực theo ngày ở múi tenant (00:00 Asia/Ho_Chi_Minh)", () => {
  it("HD4-AC02 · hạn 31/12, báo trước 30 ngày: 16:59Z ngày 30/11 còn active, 17:00Z (00:00 VN 01/12) ⇒ expiring", async () => {
    const id = await addContract(sql, { end: "2026-12-31", notice: 30 });
    const r = start("2026-11-30T16:59:00Z");
    await mark(id);
    expect(await effectAt(r, "2026-11-30T16:59:00Z", id)).toBe("active");
    await mark(id);
    expect(await effectAt(r, "2026-11-30T17:00:00Z", id)).toBe("expiring");
  });
  it("HD4-FR-02 · múi khác (UTC): cùng thời điểm 17:00Z vẫn là 30/11 ⇒ còn active", async () => {
    const id = await addContract(sql, { end: "2026-12-31", notice: 30 });
    const r = start("2026-11-30T17:00:00Z", { tz: "UTC" });
    await mark(id);
    expect(await effectAt(r, "2026-11-30T17:00:00Z", id)).toBe("active");
  });
  it("HD4-FR-02 · quá end_date ⇒ expired; effect_outcome renewed ⇒ giữ renewed (kết quả thắng ngày)", async () => {
    const a = await addContract(sql, { end: "2026-10-01", notice: 0 });
    const b = await addContract(sql, {
      end: "2026-10-01",
      notice: 0,
      handled: { outcome: "renewed" },
    });
    const r = start("2026-10-05T03:00:00Z");
    await mark(a);
    await mark(b);
    r.clock.set(new Date("2026-10-05T03:00:00Z"));
    await r.r.drain();
    expect((await rowOf(sql, a)).effect).toBe("expired");
    expect(await rowOf(sql, b)).toMatchObject({ effect: "renewed", effect_outcome: "renewed" });
  });
});

describe("HD4-NFR-03 · cách ly 2 tenant; đã gỡ chuông hạn chót", () => {
  it("HD4-AC05 · 2 tenant cùng tới hạn ⇒ mỗi tenant một lô, hiệu lực đúng từng HĐ; không còn thông báo/hàng nhắc cũ", async () => {
    const a = await addContract(sql, { tenant: T.acme, end: "2026-10-03", notice: 0 });
    const b = await addContract(sql, { tenant: T.beta, end: "2026-12-31", notice: 0 });
    const r = start("2026-10-05T03:00:00Z");
    await mark(a);
    await mark(b);
    const t = await r.r.drain();
    expect(t.batches).toBe(2);
    expect(t.failed).toBe(0);
    expect((await rowOf(sql, a)).effect).toBe("expired");
    expect((await rowOf(sql, b)).effect).toBe("active");
    expect(await notes(sql)).toEqual([]);
    expect([...(await reminderRows(sql))]).toEqual([]);
  });
});
