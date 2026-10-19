// HD7-FR-02…08 · HD7-FR-10 · HD7-AC01 · AC02 · AC04 · AC05: tiền và ngày của sổ thanh toán qua hub-api thật — parity nguyên văn
// với mgmt-app `tests/test_payments.py`, `test_ledger.py`, `test_schedule.py` (số tiền, ngày trễ, thứ tự, tổng). Viết TRƯỚC code.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeHd7,
  type CtxN1,
  call,
  d,
  deal,
  events,
  type Json,
  obligationsOf,
  ok,
  P,
  schedule,
  startHd1,
} from "./_support/hd7";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const board = (filter = "all") => ok(call(c, P.hoa, "GET", `/payments?filter=${filter}`));

describe("HD7-AC01 · bảng Thanh toán (test_payments.py)", () => {
  /** `plan` fixture: bán 2 × 92.500.000 (hôm nay, +30), mua 85.000.000 (−3), mua 27.000.000 (+5). */
  async function plan() {
    await arrangeHd7(c);
    const sale = await deal(c.sql, {
      sale: true,
      partner: "Phương Nam",
      tax: "0355555555",
      number: "PAY-S",
    });
    const buy = await deal(c.sql, {
      sale: false,
      partner: "Đà Lạt Xanh",
      tax: "0366666666",
      number: "PAY-P",
    });
    const other = await deal(c.sql, {
      sale: false,
      partner: "Hồng Hà",
      tax: "0377777777",
      number: "PAY-H",
    });
    await schedule(c, sale, [
      { due_date: d(0), amount: 92_500_000 },
      { due_date: d(30), amount: 92_500_000 },
    ]);
    await schedule(c, buy, [{ due_date: d(-3), amount: 85_000_000 }]);
    await schedule(c, other, [{ due_date: d(5), amount: 27_000_000 }]);
    return { sale, buy, other };
  }

  it("đợt mở theo trễ nhất trước, kèm đối tác + HĐ; tổng đúng từng đồng", async () => {
    const { buy } = await plan();
    const got = await board();
    const first = got.rows[0];
    expect([first.party, first.contract_title, first.direction, first.days_late]).toEqual([
      "Đà Lạt Xanh",
      "PAY-P",
      "pay",
      3,
    ]);
    expect([first.of, first.seq, first.contract_id]).toEqual([1, 1, buy]);
    // Tổng = NUMERIC (chuỗi thập phân, D7-07); đếm = số.
    expect(got.stats).toEqual({
      receive_open: "185000000",
      pay_open: "112000000",
      overdue_count: 1,
      overdue_amount: "85000000",
      due_7d: "119500000",
    });
    expect(got.rows.map((r: Json) => r.due_date)).toEqual([d(-3), d(0), d(5), d(30)]);
    expect(got.total).toBe(4);
    expect(got.rows.map((r: Json) => r.of)).toEqual([1, 2, 1, 2]);
  });

  it("lọc theo chiều và quá hạn", async () => {
    await plan();
    expect(new Set((await board("receive")).rows.map((r: Json) => r.direction))).toEqual(
      new Set(["receive"]),
    );
    expect((await board("pay")).rows.map((r: Json) => r.party)).toEqual(["Đà Lạt Xanh", "Hồng Hà"]);
    expect((await board("overdue")).rows.map((r: Json) => r.party)).toEqual(["Đà Lạt Xanh"]);
    expect((await call(c, P.hoa, "GET", "/payments?filter=nope")).status).toBe(400);
  });

  it("đã thu ⇒ ra khỏi danh sách mở, vào «Đã xong»; tổng thu giảm đúng 92.500.000", async () => {
    await plan();
    const row = (await board("receive")).rows.find((r: Json) => r.due_date === d(0));
    expect((await call(c, P.hoa, "POST", `/obligations/${row.id}/settle`, {})).status).toBe(200);
    const all = await board();
    expect(all.rows.map((r: Json) => r.id)).not.toContain(row.id);
    expect(all.stats.receive_open).toBe("92500000");
    const done = (await board("done")).rows;
    expect([done[0].id, done[0].status, done[0].done_at, done[0].days_late]).toEqual([
      row.id,
      "done",
      d(0),
      0,
    ]);
  });

  it("tiền null không làm hỏng tổng; đợt giao hàng không vào bảng tiền", async () => {
    await arrangeHd7(c);
    const id = await deal(c.sql, { sale: true, partner: "Null", tax: "0388888888" });
    await schedule(c, id, [
      { due_date: d(1), amount: null },
      { due_date: d(2), amount: 1, kind: "delivery" },
    ]);
    const got = await board();
    expect(got.rows.length).toBe(1);
    expect(got.rows[0].of).toBe(2);
    expect(got.stats.receive_open).toBe("0");
  });
});

describe("HD7-AC02 · đã trả trễ, hẹn lại, nhắc (test_ledger.py)", () => {
  it("trả 10-13 cho hạn 10-10 ⇒ paid, supplier, 3 ngày, 85.000.000; trả lại 409", async () => {
    await arrangeHd7(c);
    const buy = await deal(c.sql, {
      sale: false,
      partner: "Bình An",
      tax: "0322222222",
      number: "P-1",
    });
    const [pay] = await schedule(c, buy, [{ due_date: "2026-10-10", amount: 85_000_000 }]);
    expect(pay).toMatchObject({
      direction: "pay",
      seq: 1,
      status: "open",
      party: "tax:0322222222",
    });
    const got = await ok(
      call(c, P.hoa, "POST", `/obligations/${pay.id}/settle`, { at: "2026-10-13" }),
    );
    expect([got.status, got.done_at]).toEqual(["done", "2026-10-13"]);
    const e = (await events(c, pay.party)).at(-1);
    expect([e.type, e.role, e.days_late, e.amount, e.by, e.source]).toEqual([
      "paid",
      "supplier",
      3,
      85_000_000,
      P.hoa.id,
      "action",
    ]);
    const again = await call(c, P.hoa, "POST", `/obligations/${pay.id}/settle`, {});
    expect([again.status, again.json?.error?.code]).toEqual([409, "OBLIGATION_DONE"]);
  });

  it("số tiền thực thu ghi vào sổ, đợt giữ số tiền kế hoạch", async () => {
    await arrangeHd7(c);
    const buy = await deal(c.sql, { sale: false, partner: "Thu Một Phần", tax: "0322222223" });
    const [pay] = await schedule(c, buy, [{ due_date: "2026-10-10", amount: 85_000_000 }]);
    await ok(
      call(c, P.hoa, "POST", `/obligations/${pay.id}/settle`, {
        at: "2026-10-09",
        amount: 80_000_001,
      }),
    );
    const e = (await events(c, pay.party)).at(-1);
    expect([e.days_late, e.amount]).toEqual([0, 80_000_001]);
    expect((await obligationsOf(c.sql, buy))[0]?.amount).toBe("85000000");
  });

  it("hẹn lại về trước ⇒ 422; hẹn 10-20 ⇒ postpones 1; nhắc; trả đúng 10-20 ⇒ 0 ngày", async () => {
    await arrangeHd7(c);
    const sale = await deal(c.sql, {
      sale: true,
      partner: "Bếp Việt",
      tax: "0311111111",
      number: "S-1",
    });
    const [first] = await schedule(c, sale, [
      { due_date: "2026-10-13", amount: 92_500_000 },
      { due_date: "2026-11-13", amount: 92_500_000 },
    ]);
    const bad = await call(c, P.hoa, "POST", `/obligations/${first.id}/postpone`, {
      to: "2026-10-12",
    });
    expect([bad.status, bad.json?.error?.code]).toEqual([422, "POSTPONE_DATE"]);
    const same = await call(c, P.hoa, "POST", `/obligations/${first.id}/postpone`, {
      to: "2026-10-13",
    });
    expect(same.status).toBe(422);
    const moved = await ok(
      call(c, P.hoa, "POST", `/obligations/${first.id}/postpone`, {
        to: "2026-10-20",
        note: "hẹn tuần sau",
      }),
    );
    expect([moved.due_date, moved.postpones, moved.postponed_to]).toEqual([
      "2026-10-20",
      1,
      "2026-10-20",
    ]);
    const reminded = await ok(call(c, P.hoa, "POST", `/obligations/${first.id}/remind`, {}));
    expect(reminded.reminders).toBe(1);
    const evs = await events(c, first.party);
    expect(evs.slice(-2).map((e: Json) => e.type)).toEqual(["postponed", "reminded"]);
    expect(evs.at(-2)).toMatchObject({
      to: "2026-10-20",
      was: "2026-10-13",
      note: "hẹn tuần sau",
      at: d(0),
    });
    await ok(call(c, P.hoa, "POST", `/obligations/${first.id}/settle`, { at: "2026-10-20" }));
    expect((await events(c, first.party)).at(-1)).toMatchObject({ type: "received", days_late: 0 });
    // remind không nhận thân (strict) — mgmt `remind` không có thân; chỉ postpone mang `to`.
    for (const act of ["remind", "postpone"]) {
      const r = await call(
        c,
        P.hoa,
        "POST",
        `/obligations/${first.id}/${act}`,
        act === "postpone" ? { to: "2026-12-01" } : {},
      );
      expect({ act, status: r.status }).toEqual({ act, status: 409 });
    }
  });

  it("lịch mới giữ đợt đã xong, đánh số tiếp; đợt mở cũ bị thay (không xoá, ẩn) ⇒ 404", async () => {
    await arrangeHd7(c);
    const sale = await deal(c.sql, { sale: true, partner: "Lịch Lại", tax: "0311111112" });
    const [a, b] = await schedule(c, sale, [
      { due_date: "2026-10-13", amount: 1 },
      { due_date: "2026-11-13", amount: 2 },
    ]);
    await ok(call(c, P.hoa, "POST", `/obligations/${a.id}/settle`, { at: "2026-10-13" }));
    const after = await schedule(c, sale, [{ due_date: "2026-12-01", amount: 1 }]);
    expect(after.map((o: Json) => [o.id === a.id, o.seq, o.status, o.source])).toEqual([
      [true, 1, "done", "manual"],
      [false, 2, "open", "manual"],
    ]);
    expect((await call(c, P.hoa, "POST", `/obligations/${b.id}/remind`, {})).status).toBe(404);
    const rows = await obligationsOf(c.sql, sale);
    expect(rows.map((r) => r.status).sort()).toEqual(["done", "open", "replaced"]);
    const listed = await ok(call(c, P.hoa, "GET", `/obligations?contract_id=${sale}`));
    expect(listed.map((o: Json) => o.seq)).toEqual([1, 2]);
    expect(listed[0].contract_number).toBeString();
  });

  it("thân sai ⇒ 400: tiền âm, tiền > 10¹⁵, tiền lẻ, kind lạ, ngày sai, khoá lạ, > 120 đợt", async () => {
    await arrangeHd7(c);
    const id = await deal(c.sql, { sale: true, partner: "Sai", tax: "0311111113" });
    const bad: unknown[] = [
      { rows: [{ due_date: "2026-10-01", amount: -1 }] },
      { rows: [{ due_date: "2026-10-01", amount: 1_000_000_000_000_001 }] },
      { rows: [{ due_date: "2026-10-01", amount: 1.5 }] },
      { rows: [{ due_date: "2026-10-01", kind: "gift" }] },
      { rows: [{ due_date: "2026-02-30" }] },
      { rows: [], tenant_id: "x" },
      { rows: Array.from({ length: 121 }, () => ({ due_date: "2026-10-01" })) },
    ];
    for (const body of bad) {
      const r = await call(c, P.hoa, "PUT", `/contracts/${id}/schedule`, body);
      expect({ body: JSON.stringify(body).slice(0, 60), status: r.status }).toEqual({
        body: JSON.stringify(body).slice(0, 60),
        status: 400,
      });
    }
    expect(
      (await call(c, P.hoa, "PUT", `/contracts/${crypto.randomUUID()}/schedule`, { rows: [] }))
        .status,
    ).toBe(404);
  });
});

describe("HD7-AC04 · huỷ việc ghi nhầm hoàn tác đợt (test_voiding_a_recorded_action_undoes_it)", () => {
  it("hẹn lại ⇒ về hạn cũ; nhắc ⇒ 0 lượt; đã thu ⇒ mở lại và thu lại được; dòng vẫn còn, gạch", async () => {
    await arrangeHd7(c);
    const sale = await deal(c.sql, {
      sale: true,
      partner: "Hoàn Tác",
      tax: "0355550001",
      number: "U-1",
    });
    const [ob] = await schedule(c, sale, [{ due_date: "2026-10-13", amount: 350_000 }]);
    const last = async (type: string) =>
      (await events(c, ob.party)).filter((e: Json) => e.type === type).at(-1);
    const list = () => ok(call(c, P.hoa, "GET", `/obligations?contract_id=${sale}`));

    await ok(call(c, P.hoa, "POST", `/obligations/${ob.id}/postpone`, { to: "2026-10-20" }));
    const p = await last("postponed");
    const v = await ok(call(c, P.hoa, "POST", `/partner-events/${p.id}/void`, {}));
    expect([v.voided, v.voided_by]).toEqual([true, P.hoa.id]);
    expect((await list())[0]).toMatchObject({
      due_date: "2026-10-13",
      postpones: 0,
      postponed_to: null,
    });

    await ok(call(c, P.hoa, "POST", `/obligations/${ob.id}/remind`, {}));
    await ok(call(c, P.hoa, "POST", `/partner-events/${(await last("reminded")).id}/void`, {}));
    expect((await list())[0].reminders).toBe(0);

    await ok(call(c, P.hoa, "POST", `/obligations/${ob.id}/settle`, { at: "2026-10-15" }));
    const paid = await last("received");
    await ok(call(c, P.hoa, "POST", `/partner-events/${paid.id}/void`, {}));
    expect((await list())[0]).toMatchObject({ status: "open", done_at: null });
    // Huỷ lần hai ⇒ trả nguyên (đã huỷ), không hoàn tác thêm.
    expect((await ok(call(c, P.hoa, "POST", `/partner-events/${paid.id}/void`, {}))).voided).toBe(
      true,
    );
    await ok(call(c, P.hoa, "POST", `/obligations/${ob.id}/settle`, { at: "2026-10-13" }));
    const all = await events(c, ob.party);
    // hẹn lại, nhắc, đã thu (huỷ cả ba) + đã thu lần hai = 4 dòng (mgmt không đếm; không có dòng quá hạn vì không quét).
    expect(all.filter((e: Json) => e.voided).length).toBe(3);
    expect(all.length).toBe(4);
    expect(
      (await call(c, P.tam, "POST", `/partner-events/${(await last("received")).id}/void`, {}))
        .status,
    ).toBe(403);
  });
});

describe("HD7-FR-08 · ghi việc tay (test_manual_events_need_a_reason_to_adjust_and_are_voided_not_deleted)", () => {
  it("loại không ghi tay ⇒ 422; chỉnh tay cần lý do, −10…10; editor không chỉnh tay (403), owner được", async () => {
    await arrangeHd7(c);
    const sale = await deal(c.sql, { sale: true, partner: "Bếp Việt", tax: "0311111111" });
    const [ob] = await schedule(c, sale, [{ due_date: "2026-10-13", amount: 1 }]);
    const party = ob.party as string;
    const post = (p: (typeof P)[keyof typeof P], body: Json) =>
      call(c, p, "POST", "/partner-events", body);
    expect((await post(P.lan, { party, role: "customer", type: "paid" })).json?.error?.code).toBe(
      "EVENT_TYPE",
    );
    expect(
      (await post(P.lan, { party, role: "customer", type: "manual_adjust", delta: 5 })).status,
    ).toBe(422);
    expect(
      (await post(P.lan, { party, role: "customer", type: "manual_adjust", delta: 15, note: "x" }))
        .status,
    ).toBe(422);
    expect(
      (await post(P.lan, { party, role: "customer", type: "manual_adjust", delta: 0, note: "x" }))
        .status,
    ).toBe(422);
    expect(
      (await post(P.hoa, { party, role: "customer", type: "manual_adjust", delta: 3, note: "x" }))
        .status,
    ).toBe(403);
    const okAdj = await post(P.lan, {
      party,
      role: "customer",
      type: "manual_adjust",
      delta: -5,
      note: "chậm hồ sơ",
    });
    expect([okAdj.status, okAdj.json?.delta, okAdj.json?.by]).toEqual([201, -5, P.lan.id]);
    const cpl = await post(P.hoa, {
      party,
      role: "customer",
      type: "complaint",
      note: "trễ",
      at: "2026-01-02",
    });
    expect([cpl.status, cpl.json?.at]).toEqual([201, "2026-01-02"]);
    expect(
      (await post(P.hoa, { party: "tax:0999999999", role: "customer", type: "complaint" })).status,
    ).toBe(404);
    await ok(call(c, P.hoa, "POST", `/partner-events/${cpl.json.id}/void`, {}));
    expect((await events(c, party)).find((e: Json) => e.id === cpl.json.id)?.voided).toBe(true);
  });
});

describe("HD7-AC05 · lịch mặc định khi HĐ được duyệt (test_schedule.py)", () => {
  it("chưa có đợt + vào trạng thái đã duyệt ⇒ 1 đợt toàn giá trị vào end_date; chiều theo HĐ; một lần", async () => {
    await arrangeHd7(c);
    const id = await deal(c.sql, {
      sale: true,
      partner: "Lịch Bán",
      tax: "0355552222",
      value: 12_000_000,
      end: "2027-03-31",
      status: "needs_review",
    });
    expect(await obligationsOf(c.sql, id)).toHaveLength(0);
    await c.sql`update contracts.contracts set status = 'active' where id = ${id}`;
    const rows = await obligationsOf(c.sql, id);
    expect(rows.map((r) => [r.due_date, r.amount, r.source, r.seq, r.status])).toEqual([
      ["2027-03-31", "12000000", "default", 1, "open"],
    ]);
    const [ob] = await ok(call(c, P.hoa, "GET", `/obligations?contract_id=${id}`));
    expect([ob.direction, ob.party]).toEqual(["receive", "tax:0355552222"]);
    await c.sql`update contracts.contracts set status = 'needs_review' where id = ${id}`;
    await c.sql`update contracts.contracts set status = 'active' where id = ${id}`;
    expect((await obligationsOf(c.sql, id)).length).toBe(1);
  });
  it("không end ⇒ start ⇒ signed; không ngày ⇒ không lập; chưa biết bên ⇒ không lập; phụ lục ⇒ không lập", async () => {
    await arrangeHd7(c);
    const a = await deal(c.sql, {
      start: "2026-12-01",
      signed: "2026-11-01",
      status: "needs_review",
    });
    const b = await deal(c.sql, { signed: "2026-11-01", status: "needs_review" });
    const none = await deal(c.sql, { status: "needs_review" });
    const blind = await deal(c.sql, { sale: null, end: "2026-12-31", status: "needs_review" });
    await c.sql`update contracts.contracts set status = 'active' where id in ${c.sql([a, b, none, blind])}`;
    expect((await obligationsOf(c.sql, a)).map((r) => r.due_date)).toEqual(["2026-12-01"]);
    expect((await obligationsOf(c.sql, b)).map((r) => r.due_date)).toEqual(["2026-11-01"]);
    expect(await obligationsOf(c.sql, none)).toHaveLength(0);
    expect(await obligationsOf(c.sql, blind)).toHaveLength(0);
  });
  it("HĐ đã có lịch người đặt ⇒ không đè; giá trị > 10¹⁵ ⇒ đợt không tiền", async () => {
    await arrangeHd7(c);
    const id = await deal(c.sql, { sale: false, end: "2026-12-31", status: "needs_review" });
    await schedule(c, id, [{ due_date: "2026-11-30", amount: 7 }]);
    await c.sql`update contracts.contracts set status = 'active' where id = ${id}`;
    expect((await obligationsOf(c.sql, id)).map((r) => r.source)).toEqual(["manual"]);
    const big = await deal(c.sql, {
      value: 9_000_000_000_000_000,
      end: "2026-12-31",
      status: "needs_review",
    });
    await c.sql`update contracts.contracts set status = 'active' where id = ${big}`;
    expect((await obligationsOf(c.sql, big)).map((r) => r.amount)).toEqual([null]);
  });
});

describe("HD7-FR-10 · đối tác của HĐ (test_a_contract_page_knows_its_partner…)", () => {
  it("bán ⇒ khách hàng, tên bên mua; danh sách đợt theo đối tác có số HĐ", async () => {
    await arrangeHd7(c);
    const sale = await deal(c.sql, {
      sale: true,
      partner: "Trang Hợp Đồng",
      tax: "0355550002",
      number: "K-7",
    });
    const p = await ok(call(c, P.tam, "GET", `/contracts/${sale}/partner`));
    expect(p).toEqual({ party: "tax:0355550002", role: "customer", name: "Trang Hợp Đồng" });
    await schedule(c, sale, [{ due_date: "2026-10-13", amount: 1 }]);
    const rows = await ok(
      call(c, P.tam, "GET", `/obligations?party=${encodeURIComponent(p.party)}&status=open`),
    );
    expect(rows.map((r: Json) => r.contract_number)).toEqual(["K-7"]);
    expect((await call(c, P.an, "GET", `/contracts/${sale}/partner`)).status).toBe(404);
  });
});
