// HD4-FR-01…05 · HD4-FR-07 · HD4-NFR-03 · HD4-AC01…05: hạn chót (trigger DB), trạng thái theo ngày ở múi tenant, vòng nhắc theo tập
// qua N3 `notify.enqueue` — idempotent, đúng mốc nhỏ nhất, cách ly 2 tenant, chạy song song không nhân đôi. Đồng hồ giả, gọi
// `once()`/`drain()` trực tiếp (Luật 4c: không sleep/poll).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { setupX2a } from "../X2a/_x2a";
import {
  addContract,
  needHd4,
  notes,
  P,
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
const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const setFields = (id: string, patch: Record<string, unknown>) =>
  sql`update contracts.contracts set fields = fields || ${sql.json(patch as never)} where id = ${id}`;
const fv = (value: unknown) => ({ value, quote: "", verified: false, edited: true });

describe("HD4-FR-01 · HD4-AC01 · action_deadline = end_date − notice_days (trigger DB, mọi đường ghi)", () => {
  it("HD4-AC01 · notice 30 ⇒ 2026-12-01; notice rỗng/lạ/ngoài 0…3650 ⇒ end_date; phụ lục ⇒ null", async () => {
    const a = await addContract(sql, { end: "2026-12-31", notice: 30 });
    const b = await addContract(sql, { end: "2026-12-31", notice: null });
    const c = await addContract(sql, { end: "2026-12-31", notice: "abc" });
    const d = await addContract(sql, { end: "2026-12-31", notice: 5000 });
    const e = await addContract(sql, { end: null });
    const f = await addContract(sql, { kind: "appendix", parent: a, status: "active" });
    const got = await Promise.all(
      [a, b, c, d, e, f].map(async (id) => (await rowOf(sql, id)).action_deadline),
    );
    expect(got).toEqual(["2026-12-01", "2026-12-31", "2026-12-31", "2026-12-31", null, null]);
  });
  it("HD4-FR-05 · lịch: HĐ đã duyệt ⇒ remind_at = -infinity; needs_review/phụ lục ⇒ null; needs_review → active ⇒ -infinity", async () => {
    const a = await addContract(sql, { status: "active" });
    const n = await addContract(sql, { status: "needs_review" });
    const ap = await addContract(sql, { kind: "appendix", parent: a });
    expect([
      (await rowOf(sql, a)).due,
      (await rowOf(sql, n)).due,
      (await rowOf(sql, ap)).due,
    ]).toEqual(["-infinity", null, null]);
    await sql`update contracts.contracts set status = 'active' where id = ${n}`;
    expect((await rowOf(sql, n)).due).toBe("-infinity");
  });
  it("HD4-AC01 · đổi end_date ⇒ hạn mới, handled = null, renewed → active, lịch chạy lại; đổi trường khác ⇒ giữ handled", async () => {
    const id = await addContract(sql, {
      status: "renewed",
      handled: { outcome: "renewed", by: P.lan.id },
    });
    await sql`update contracts.contracts set remind_at = null where id = ${id}`;
    await setFields(id, { title: fv("Đổi tiêu đề") });
    expect(await rowOf(sql, id)).toMatchObject({
      status: "renewed",
      handled: { outcome: "renewed" },
      remind_at: null,
    });
    await setFields(id, { end_date: fv("2027-03-31") });
    expect(await rowOf(sql, id)).toMatchObject({
      action_deadline: "2027-03-01",
      handled: null,
      status: "active",
      due: "-infinity",
    });
  });
});

describe("HD4-FR-02 · HD4-AC02 · trạng thái theo ngày ở múi tenant (00:00 Asia/Ho_Chi_Minh)", () => {
  it("HD4-AC02 · 16:59Z ngày 31/10 còn active, 17:00Z (00:00 VN 01/11) ⇒ expiring; mốc 60 lúc 08:00 VN; remind_at = sự kiện kế", async () => {
    const id = await addContract(sql, { end: "2026-12-31", notice: 0 });
    const r = start("2026-10-31T16:59:00Z");
    expect((await r.r.once())?.tenantId).toBe(T.acme);
    expect(await rowOf(sql, id)).toMatchObject({ status: "active" });
    expect(iso((await rowOf(sql, id)).remind_at)).toBe("2026-10-31T17:00:00.000Z");
    expect(await notes(sql)).toEqual([]);
    expect(await r.r.once()).toBeNull(); // chưa tới hạn ⇒ không có lô

    r.clock.set(new Date("2026-10-31T17:00:00Z"));
    await r.r.once();
    expect((await rowOf(sql, id)).status).toBe("expiring");
    expect(iso((await rowOf(sql, id)).remind_at)).toBe("2026-11-01T01:00:00.000Z");
    expect(await notes(sql)).toEqual([]);

    r.clock.set(new Date("2026-11-01T01:00:00Z"));
    await r.r.once();
    const n = await notes(sql);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      tenant_id: T.acme,
      user_id: P.lan.id,
      kind: "contract.deadline",
      link: `/contracts/${id}`,
      dedup_key: `remind:${id}:2026-12-31:60`,
    });
    expect(n[0]?.title).toContain("hạn chót hành động 31/12/2026");
    expect(n[0]?.body).toContain("còn 60 ngày");
    expect(iso((await rowOf(sql, id)).remind_at)).toBe("2026-12-01T01:00:00.000Z"); // mốc 30 lúc 08:00 VN
  });
  it("HD4-FR-02 · múi khác (UTC): cùng thời điểm 17:00Z vẫn là 31/10 ⇒ còn active", async () => {
    const id = await addContract(sql, { end: "2026-12-31", notice: 0 });
    const r = start("2026-10-31T17:00:00Z", { tz: "UTC" });
    await r.r.once();
    expect(await rowOf(sql, id)).toMatchObject({ status: "active" });
    expect(iso((await rowOf(sql, id)).remind_at)).toBe("2026-11-01T00:00:00.000Z");
  });
  it("HD4-FR-02 · quá end_date ⇒ expired + mốc 0 gửi một lần; handled renewed ⇒ renewed, không nhắc, hết lịch", async () => {
    const ex = await addContract(sql, { end: "2026-09-20", notice: 0 });
    const rn = await addContract(sql, {
      end: "2026-10-05",
      notice: 0,
      handled: { outcome: "renewed" },
    });
    const nr = await addContract(sql, {
      end: "2026-10-05",
      notice: 0,
      handled: { outcome: "not_renewed" },
    });
    const r = start("2026-10-01T03:00:00Z");
    await r.r.drain();
    expect(
      [await rowOf(sql, ex), await rowOf(sql, rn), await rowOf(sql, nr)].map((x) => [
        x.status,
        x.remind_at,
      ]),
    ).toEqual([
      ["expired", null],
      ["renewed", null],
      ["terminated", null],
    ]);
    expect((await notes(sql)).map((n) => n.dedup_key)).toEqual([`remind:${ex}:2026-09-20:0`]);
  });
});

describe("HD4-FR-03 · HD4-FR-04 · HD4-AC03 · mốc nhỏ nhất đã tới, gửi đúng một lần", () => {
  it("HD4-AC03 · còn 5 ngày lúc duyệt ⇒ chỉ mốc 7; chạy lại ⇒ 0 mới; 08:00 VN ngày trước hạn ⇒ mốc 1", async () => {
    const id = await addContract(sql, { end: "2026-10-06", notice: 0 });
    const r = start("2026-10-01T03:00:00Z"); // 10:00 VN
    await r.r.once();
    expect((await rowOf(sql, id)).status).toBe("expiring");
    expect(await reminderRows(sql)).toEqual([
      { contract_id: id, deadline: "2026-10-06", milestone: 7, user_id: P.lan.id },
    ]);
    expect((await notes(sql)).map((n) => n.dedup_key)).toEqual([`remind:${id}:2026-10-06:7`]);
    expect(iso((await rowOf(sql, id)).remind_at)).toBe("2026-10-05T01:00:00.000Z");

    await sql`update contracts.contracts set remind_at = '-infinity' where id = ${id}`; // ép chạy lại cùng ngày
    await r.r.once();
    expect(await notes(sql)).toHaveLength(1);
    expect(await reminderRows(sql)).toHaveLength(1);

    r.clock.set(new Date("2026-10-05T00:59:00Z"));
    expect(await r.r.once()).toBeNull();
    r.clock.set(new Date("2026-10-05T01:00:00Z"));
    await r.r.once();
    const n = await notes(sql);
    expect(n.map((x) => x.dedup_key)).toEqual([
      `remind:${id}:2026-10-06:7`,
      `remind:${id}:2026-10-06:1`,
    ]);
    expect(n[1]?.body).toContain("còn 1 ngày");
  });
  it("HD4-AC04 · negotiating ⇒ không nhắc (trạng thái vẫn theo ngày); đổi hạn ⇒ handled null, nhắc theo hạn mới", async () => {
    const id = await addContract(sql, {
      end: "2026-10-06",
      notice: 0,
      handled: { outcome: "negotiating" },
    });
    const r = start("2026-10-01T03:00:00Z");
    await r.r.once();
    expect(await rowOf(sql, id)).toMatchObject({
      status: "expiring",
      handled: { outcome: "negotiating" },
    });
    expect(await notes(sql)).toEqual([]);
    expect(iso((await rowOf(sql, id)).remind_at)).toBe("2026-10-06T17:00:00.000Z"); // expired lúc 00:00 VN 07/10
    await setFields(id, { end_date: fv("2026-10-20") });
    await r.r.once();
    expect((await rowOf(sql, id)).handled).toBeNull();
    expect((await notes(sql)).map((x) => x.dedup_key)).toEqual([`remind:${id}:2026-10-20:30`]);
  });
  it("HD4-FR-03 · không người phụ trách / chưa duyệt / phụ lục ⇒ không nhắc", async () => {
    const a = await addContract(sql, { end: "2026-10-06", owner: null });
    await addContract(sql, { end: "2026-10-06", status: "needs_review" });
    await addContract(sql, { kind: "appendix", parent: a, end: "2026-10-06" });
    const r = start("2026-10-01T03:00:00Z");
    await r.r.drain();
    expect(await notes(sql)).toEqual([]);
    expect((await rowOf(sql, a)).status).toBe("expiring");
  });
});

describe("HD4-NFR-03 · HD4-AC05 · 2 tenant, song song", () => {
  it("HD4-AC05 · mỗi tenant chỉ người của mình nhận; người phụ trách ngoài tenant ⇒ N3 bỏ qua lặng lẽ", async () => {
    const a = await addContract(sql, { tenant: T.acme, owner: P.lan.id, end: "2026-10-06" });
    const b = await addContract(sql, { tenant: T.beta, owner: P.an.id, end: "2026-10-06" });
    await addContract(sql, { tenant: T.acme, owner: P.an.id, end: "2026-10-06" });
    const r = start("2026-10-01T03:00:00Z");
    const tot = await r.r.drain();
    expect(tot.batches).toBe(2);
    const n = await notes(sql);
    expect(n.map((x) => [x.tenant_id, x.user_id, x.link]).sort()).toEqual(
      [
        [T.acme, P.lan.id, `/contracts/${a}`],
        [T.beta, P.an.id, `/contracts/${b}`],
      ].sort(),
    );
  });
  it("HD4-FR-04 · hai vòng chạy song song trên 2 pool (SKIP LOCKED) ⇒ mỗi HĐ đúng 1 thông báo, 1 hàng nhắc", async () => {
    for (let i = 0; i < 30; i++) await addContract(sql, { end: "2026-10-06" });
    const r1 = start("2026-10-01T03:00:00Z");
    const r2 = startReminders({ at: "2026-10-01T03:00:00Z", batch: 7 });
    try {
      await Promise.all([r1.r.drain(), r2.r.drain()]);
    } finally {
      await r2.stop();
    }
    expect(await notes(sql)).toHaveLength(30);
    expect(await reminderRows(sql)).toHaveLength(30);
    const [d] = await sql<
      { n: number }[]
    >`select count(distinct dedup_key)::int as n from hub.notifications`;
    expect(d?.n).toBe(30);
  });
});
