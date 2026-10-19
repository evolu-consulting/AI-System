// HD7-FR-09 · HD7-AC03 · HD7-NFR-02: vòng quá hạn THẬT (pool `hub_api`, role `contracts_rw` + `app.tenant_id`, đồng hồ giả, không
// sleep) — parity `mgmt-app/api/tests/test_overdue.py`: ghi một lần, hẹn lại rồi quá ⇒ ghi lại, dòng hệ thống không huỷ được, lịch
// mới huỷ dòng quá hạn cũ. Ngày "hôm nay" = ngày lịch múi tenant (HD4 `localDate`). Viết TRƯỚC code.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeHd7,
  type CtxN1,
  call,
  deal,
  events,
  type Json,
  obligationsOf,
  ok,
  P,
  type Sweep,
  schedule,
  startHd1,
  startSweep,
  T,
} from "./_support/hd7";

let c: CtxN1;
let sw: Sweep | undefined;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await sw?.stop();
  await c?.stop();
});

/** 10h sáng ngày `day` ở VN. */
const vnMorning = (day: string) => `${day}T03:00:00Z`;
async function sweepAt(day: string): Promise<number> {
  if (!sw) sw = startSweep({ at: vnMorning(day) });
  else sw.clock.set(new Date(vnMorning(day)));
  return sw.s.drain();
}
async function sale(tax: string, number: string, due = "2026-10-01") {
  const id = await deal(c.sql, { sale: true, partner: `Khách ${number}`, tax, number });
  const [ob] = await schedule(c, id, [{ due_date: due, amount: 350_000 }]);
  return { id, ob };
}
const overdueLines = async (party: string) =>
  (await events(c, party)).filter((e: Json) => e.type === "overdue");

describe("HD7-AC03 · dòng quá hạn do hệ thống ghi", () => {
  it("hạn hôm nay chưa trễ; quá ⇒ đúng một dòng (at = hạn + 1, hệ thống, party_late, 350.000); quét lại 0", async () => {
    await arrangeHd7(c);
    const { ob } = await sale("0366660001", "OD-1");
    expect(await sweepAt("2026-10-01")).toBe(0);
    expect(await sweepAt("2026-10-10")).toBe(1);
    expect(await sweepAt("2026-10-11")).toBe(0);
    const got = await overdueLines(ob.party);
    expect(got.length).toBe(1);
    const e = got[0];
    expect([e.at, e.source, e.by, e.due_date, e.obligation_id, e.role, e.kind, e.seq]).toEqual([
      "2026-10-02",
      "system",
      null,
      "2026-10-01",
      ob.id,
      "customer",
      "payment",
      1,
    ]);
    expect([e.party_late, e.amount, e.voided]).toEqual([true, 350_000, false]);
    expect((await obligationsOf(c.sql, ob.contract_id))[0]?.overdue_for).toBe("2026-10-01");
  });

  it("mình trả trễ ⇒ party_late=false; đợt không có đối tác ⇒ không ghi; đợt đã xong ⇒ không ghi", async () => {
    await arrangeHd7(c);
    const buy = await deal(c.sql, { sale: false, partner: "NCC", tax: "0366660010" });
    const [ours] = await schedule(c, buy, [{ due_date: "2026-10-01", amount: 1 }]);
    const anon = await deal(c.sql, { sale: true, partner: "", tax: null });
    await schedule(c, anon, [{ due_date: "2026-10-01", amount: 1 }]);
    const paid = await deal(c.sql, { sale: true, partner: "Đã trả", tax: "0366660011" });
    const [p] = await schedule(c, paid, [{ due_date: "2026-10-01", amount: 1 }]);
    await ok(call(c, P.hoa, "POST", `/obligations/${p.id}/settle`, { at: "2026-10-01" }));
    expect(await sweepAt("2026-10-05")).toBe(1);
    expect((await overdueLines(ours.party))[0]).toMatchObject({
      party_late: false,
      role: "supplier",
    });
    expect((await obligationsOf(c.sql, anon))[0]?.overdue_for).toBeNull();
  });

  it("hẹn lại rồi ngày hẹn cũng qua ⇒ ghi lần nữa (hạn [10-01, 10-20])", async () => {
    await arrangeHd7(c);
    const { ob } = await sale("0366660002", "OD-2");
    await sweepAt("2026-10-05");
    await ok(call(c, P.hoa, "POST", `/obligations/${ob.id}/postpone`, { to: "2026-10-20" }));
    await sweepAt("2026-10-25");
    expect((await overdueLines(ob.party)).map((e: Json) => e.due_date)).toEqual([
      "2026-10-01",
      "2026-10-20",
    ]);
  });

  it("dòng hệ thống không huỷ được (422 EVENT_SYSTEM)", async () => {
    await arrangeHd7(c);
    const { ob } = await sale("0366660003", "OD-3");
    await sweepAt("2026-10-09");
    const [e] = await overdueLines(ob.party);
    const r = await call(c, P.lan, "POST", `/partner-events/${e.id}/void`, {});
    expect([r.status, r.json?.error?.code]).toEqual([422, "EVENT_SYSTEM"]);
  });

  it("lịch mới huỷ dòng quá hạn của đợt bị thay (người huỷ = hệ thống); id cũ ⇒ 404", async () => {
    await arrangeHd7(c);
    const { id, ob } = await sale("0366660004", "OD-4");
    await sweepAt("2026-10-09");
    await schedule(c, id, [{ due_date: "2026-11-30", amount: 350_000 }]);
    const lines = await overdueLines(ob.party);
    expect(lines.length).toBe(1);
    expect([lines[0].voided, lines[0].voided_by]).toEqual([true, null]);
    expect((await call(c, P.hoa, "POST", `/obligations/${ob.id}/remind`, {})).status).toBe(404);
  });
});

describe("HD7-FR-09 · ngày theo múi tenant (HD4 localDate)", () => {
  it("VN: 2026-10-01T16:59Z vẫn là ngày 01 (chưa trễ); 17:00Z là ngày 02 ⇒ ghi", async () => {
    await arrangeHd7(c);
    await sale("0366660005", "OD-5");
    const s = startSweep({ at: "2026-10-01T16:59:00Z" });
    try {
      expect(await s.s.drain()).toBe(0);
      s.clock.set(new Date("2026-10-01T17:00:00Z"));
      expect(await s.s.drain()).toBe(1);
    } finally {
      await s.stop();
    }
  });
  it("múi khác (America/New_York): 2026-10-02T03:59Z vẫn là 10-01 ở NY ⇒ chưa trễ", async () => {
    await arrangeHd7(c);
    await sale("0366660006", "OD-6");
    const s = startSweep({ at: "2026-10-02T03:59:00Z", tz: "America/New_York" });
    try {
      expect(await s.s.drain()).toBe(0);
      s.clock.set(new Date("2026-10-02T04:00:00Z"));
      expect(await s.s.drain()).toBe(1);
    } finally {
      await s.stop();
    }
  });
});

describe("HD7-NFR-02 · theo tập, cách ly tenant", () => {
  it("lô cố định 2 câu (set_config + CTE) bất kể số đợt; mỗi tenant chỉ ghi sổ của mình", async () => {
    await arrangeHd7(c);
    for (let i = 0; i < 7; i++) await sale(`03666601${i}0`, `B-${i}`);
    const beta = await deal(c.sql, {
      sale: true,
      partner: "Beta",
      tax: "0366669999",
      tenant: T.beta,
    });
    await c.sql`insert into contracts.obligations (tenant_id, contract_id, party_key, direction, seq, due_date, amount)
      values (${T.beta}, ${beta}, 'tax:0366669999', 'receive', 1, '2026-10-01', 5)`;
    const s = startSweep({ at: vnMorning("2026-10-05"), tenants: [T.acme], batch: 3 });
    try {
      const one = await s.count(() => s.s.once(T.acme));
      expect([one.r, one.n]).toEqual([3, 2]);
      const rest = await s.count(() => s.s.drain());
      expect(rest.r).toBe(4);
      // 2 lô đầy (3) … thực tế: 3 + 1 rồi lô rỗng không có ⇒ lô cuối < batch dừng.
      expect(rest.n).toBe(4);
    } finally {
      await s.stop();
    }
    const [b] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.partner_events
      where tenant_id = ${T.beta}`;
    expect(b?.n).toBe(0);
  });
});
