// V2-A · tiền + vòng đời mốc qua hub-api thật — viết TRƯỚC code. BA v2 §2 (loại HĐ, mốc, giai đoạn), §3.1 HD-01/HD-09/HD-11,
// §5.4a (mốc trống chia đều giá trị), §5.4c (hoa hồng = phí gốc × % hoặc cố định), C3 (tenant tắt duyệt: lưu = có hiệu lực).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  deal,
  detail,
  type Json,
  manual,
  manualRaw,
  ok,
  P,
  restoreApproval,
  rowsOf,
  setApproval,
  startHd1,
  T,
} from "./_support/v2a";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

async function v2(): Promise<void> {
  await arrangeV2a(c);
  await setApproval(c.sql, T.acme, false);
}
const add = (id: string, b: Json) => ok(call(c, P.hoa, "POST", `/contracts/${id}/milestones`, b));
const pick = (m: Json) => [m.kind, m.owner, m.amount, m.amount_effective, m.confirmed];

describe("V2-A · HD-01 lưu HĐ ở tenant tắt duyệt ⇒ có hiệu lực + mốc mặc định theo loại", () => {
  it("Bán 100.000.001: active, Giao (mình) + Thu tiền (khách) trống ⇒ tính đủ giá trị; giai đoạn Chưa bắt đầu", async () => {
    await v2();
    const out = await manual(c, {
      deal: "sell",
      total_value: 100_000_001,
      start_date: d(10),
      end_date: d(40),
    });
    expect(out.status).toBe("active");
    const x = await detail(c, out.id);
    expect([x.deal, x.direction, x.status, x.stage, x.start_date]).toEqual([
      "sell",
      "sale",
      "active",
      "not_started",
      d(10),
    ]);
    expect(x.milestones.map(pick)).toEqual([
      ["delivery", "ours", null, null, false],
      ["collect", "partner", null, 100_000_001, false],
    ]);
    expect(x.milestones.map((m: Json) => [m.title, m.due_date, m.source])).toEqual([
      ["Giao hàng", d(10), "default"],
      ["Thu tiền", d(40), "default"],
    ]);
  });

  it("Mua: Giao (NCC) + Thanh toán (mình); loại không có approval ⇒ không mở lượt duyệt", async () => {
    await v2();
    const out = await manual(c, { deal: "buy", total_value: 5_000_000, end_date: d(3) });
    const x = await detail(c, out.id);
    expect(x.milestones.map(pick)).toEqual([
      ["delivery", "partner", null, null, false],
      ["pay", "ours", null, 5_000_000, false],
    ]);
    const [a] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.approvals
      where contract_id = ${out.id}`;
    expect(a?.n).toBe(0);
  });

  it("tenant BẬT duyệt: HĐ chờ duyệt (needs_review), chưa có mốc (mốc HD7 sinh khi duyệt)", async () => {
    await arrangeV2a(c);
    await setApproval(c.sql, T.acme, true);
    const out = await manual(c, { direction: "sale", total_value: 9_000_000 });
    expect(out.status).toBe("needs_review");
    expect(await rowsOf(c.sql, out.id)).toEqual([]);
  });
});

describe("V2-A · 5.4c hoa hồng (Giới thiệu)", () => {
  it("12,5% × 1.234.567 ⇒ 154.321 (làm tròn nửa lên); cố định 250.000 ⇒ 250.000; đối tác ở phía trả HH", async () => {
    await v2();
    const a = await manual(c, { deal: "referral", total_value: 1_234_567, commission_pct: 12.5 });
    const x = await detail(c, a.id);
    expect([x.deal, x.direction, x.commission_pct, x.commission_fixed]).toEqual([
      "referral",
      "sale",
      12.5,
      null,
    ]);
    expect(x.milestones.map(pick)).toEqual([["commission", "partner", null, 154_321, false]]);
    const b = await manual(c, {
      deal: "referral",
      total_value: 1_234_567,
      commission_fixed: 250_000,
    });
    expect((await detail(c, b.id)).milestones.map(pick)).toEqual([
      ["commission", "partner", null, 250_000, false],
    ]);
  });

  it("hoa hồng cho HĐ Bán / cả % lẫn cố định / deal lệch direction ⇒ 400, không tạo HĐ", async () => {
    await v2();
    const r = [
      await manualRaw(c, { deal: "sell", commission_pct: 5 }),
      await manualRaw(c, { deal: "referral", commission_pct: 5, commission_fixed: 1 }),
      await manualRaw(c, { deal: "buy", direction: "sale" }),
      await manualRaw(c, {}),
      await manualRaw(c, { deal: "referral", commission_pct: 12.345 }),
    ];
    expect(r.map((x) => x.status)).toEqual([400, 400, 400, 400, 400]);
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.contracts`;
    expect(n?.n).toBe(0);
  });
});

describe("V2-A · 5.4a mốc trống chia đều phần còn lại", () => {
  it("3 mốc thu trống trên 100.000.001 ⇒ 33.333.334 / 33.333.334 / 33.333.333; mốc ghi tiền giữ nguyên", async () => {
    await v2();
    const out = await manual(c, { deal: "sell", total_value: 100_000_001 });
    await add(out.id, { kind: "collect", due_date: d(50) });
    await add(out.id, { kind: "collect", due_date: d(60) });
    const x = await detail(c, out.id);
    const money = x.milestones.filter((m: Json) => m.kind === "collect");
    expect(money.map((m: Json) => m.amount_effective)).toEqual([
      33_333_334, 33_333_334, 33_333_333,
    ]);
    await ok(call(c, P.hoa, "PATCH", `/milestones/${money[0].id}`, { amount: 40_000_000 }));
    const y = (await detail(c, out.id)).milestones.filter((m: Json) => m.kind === "collect");
    expect(y.map((m: Json) => [m.amount, m.amount_effective])).toEqual([
      [40_000_000, 40_000_000],
      [null, 30_000_001],
      [null, 30_000_000],
    ]);
  });

  it("SL chỉ cho Giao hàng; số tiền chỉ cho Thu/Thanh toán/Hoa hồng ⇒ 422 MILESTONE_INVALID", async () => {
    await v2();
    const id = await deal(c.sql, { sale: true });
    const r = [
      await call(c, P.hoa, "POST", `/contracts/${id}/milestones`, {
        kind: "collect",
        due_date: d(1),
        qty: 3,
      }),
      await call(c, P.hoa, "POST", `/contracts/${id}/milestones`, {
        kind: "delivery",
        due_date: d(1),
        amount: 10,
      }),
    ];
    expect(r.map((x) => [x.status, x.json?.error?.code])).toEqual([
      [422, "MILESTONE_INVALID"],
      [422, "MILESTONE_INVALID"],
    ]);
    const ok1 = await add(id, { kind: "delivery", due_date: d(1), qty: 12.5 });
    expect([ok1.kind, ok1.qty, ok1.owner]).toEqual(["delivery", 12.5, "ours"]);
  });
});

describe("V2-A · KN-07 mốc đã xác nhận giữ nguyên + lỗi do ai", () => {
  it("xác nhận trễ có lỗi đối tác ⇒ ghi fault; sửa/xoá mốc đã xác nhận ⇒ 409, hàng không đổi", async () => {
    await v2();
    const id = await deal(c.sql, { sale: true, partner: "Khách Trễ", tax: "0311111111" });
    const m = await add(id, { kind: "collect", due_date: d(-4), amount: 7_000_000 });
    const s = await ok(
      call(c, P.hoa, "POST", `/obligations/${m.id}/settle`, { at: d(0), fault: "partner" }),
    );
    expect([s.status, s.done_at]).toEqual(["done", d(0)]);
    const before = await rowsOf(c.sql, id);
    expect(before.map((r) => [r.status, r.fault, r.amount])).toEqual([
      ["done", "partner", "7000000"],
    ]);
    const r = [
      await call(c, P.hoa, "PATCH", `/milestones/${m.id}`, { amount: 1 }),
      await call(c, P.hoa, "DELETE", `/milestones/${m.id}`),
    ];
    expect(r.map((x) => [x.status, x.json?.error?.code])).toEqual([
      [409, "MILESTONE_CONFIRMED"],
      [409, "MILESTONE_CONFIRMED"],
    ]);
    expect(await rowsOf(c.sql, id)).toEqual(before);
    const [e] = await c.sql<{ late: number; fault: string }[]>`select days_late as late,
      data ->> 'fault' as fault from contracts.partner_events where obligation_id = ${m.id} and type = 'received'`;
    expect(e).toEqual({ late: 4, fault: "partner" });
  });

  it("trễ mà không chọn ⇒ unknown; đúng hạn ⇒ không ghi lỗi; huỷ dòng xác nhận ⇒ mốc mở lại, bỏ lỗi", async () => {
    await v2();
    const id = await deal(c.sql, { sale: true, partner: "Khách B", tax: "0322222222" });
    const late = await add(id, { kind: "collect", due_date: d(-2) });
    const onTime = await add(id, { kind: "delivery", due_date: d(3) });
    await ok(call(c, P.hoa, "POST", `/obligations/${late.id}/settle`, { at: d(0) }));
    await ok(
      call(c, P.hoa, "POST", `/obligations/${onTime.id}/settle`, { at: d(0), fault: "partner" }),
    );
    expect((await rowsOf(c.sql, id)).map((r) => r.fault)).toEqual(["unknown", null]);
    const [ev] = await c.sql<{ id: string }[]>`select id::text from contracts.partner_events
      where obligation_id = ${late.id} and type = 'received'`;
    await ok(call(c, P.hoa, "POST", `/partner-events/${ev?.id}/void`, {}));
    expect((await rowsOf(c.sql, id)).map((r) => [r.status, r.fault])).toEqual([
      ["open", null],
      ["done", null],
    ]);
  });

  it("xoá mốc chưa xác nhận ⇒ biến khỏi chi tiết (đợt `replaced`, sổ chỉ thêm); sửa hạn/loại/việc của ai được", async () => {
    await v2();
    const out = await manual(c, { deal: "sell", total_value: 1_000 });
    const x = await detail(c, out.id);
    const [give, collect] = x.milestones;
    const del = await call(c, P.hoa, "DELETE", `/milestones/${give.id}`);
    expect(del.status).toBe(204);
    const p = await ok(
      call(c, P.hoa, "PATCH", `/milestones/${collect.id}`, {
        kind: "commission",
        due_date: d(9),
        owner: "ours",
        title: "Hoa hồng tháng",
      }),
    );
    expect([p.kind, p.due_date, p.owner, p.title]).toEqual([
      "commission",
      d(9),
      "ours",
      "Hoa hồng tháng",
    ]);
    const y = await detail(c, out.id);
    expect(y.milestones.map((m: Json) => m.id)).toEqual([collect.id]);
    const raw = await rowsOf(c.sql, out.id);
    expect(raw.map((r) => r.status)).toEqual(["replaced", "open"]);
  });
});

describe("V2-A · HD-09 loại HĐ không đổi sau khi lưu; backfill theo hướng", () => {
  it("HĐ cũ (chỉ direction) ⇒ deal suy ra; đổi deal của HĐ đã có hiệu lực ⇒ DB từ chối", async () => {
    await arrangeV2a(c);
    const id = await deal(c.sql, { sale: false });
    const [r] = await c.sql<
      { deal: string }[]
    >`select deal from contracts.contracts where id = ${id}`;
    expect(r?.deal).toBe("buy");
    const err =
      await c.sql`update contracts.contracts set deal = 'sell', direction = 'sale' where id = ${id}`.catch(
        (e: { constraint_name?: string }) => e.constraint_name,
      );
    expect(err).toBe("contracts_deal_fixed");
  });
});

describe("V2-A · KN-04 giai đoạn + bước hiện tại (chi tiết + danh sách)", () => {
  it("xác nhận giao ⇒ Đang thực hiện, bước hiện tại = Thu tiền (quá hạn đỏ); xác nhận hết ⇒ Đã xong", async () => {
    await v2();
    const out = await manual(c, {
      deal: "sell",
      total_value: 10,
      start_date: d(5),
      end_date: d(-1),
    });
    const x = await detail(c, out.id);
    // dòng thời gian theo hạn: Thu tiền (hạn kết thúc, đã qua) đứng trước Giao hàng (hạn bắt đầu)
    expect(x.milestones.map((m: Json) => m.kind)).toEqual(["collect", "delivery"]);
    const [collect, give] = x.milestones;
    await ok(call(c, P.hoa, "POST", `/obligations/${give.id}/settle`, { at: d(0) }));
    const y = await detail(c, out.id);
    expect([y.stage, y.next_milestone_id]).toEqual(["in_progress", collect.id]);
    const list = await ok(call(c, P.hoa, "GET", "/contracts"));
    expect(list.progress).toEqual([
      {
        id: out.id,
        deal: "sell",
        stage: "in_progress",
        next: {
          id: collect.id,
          kind: "collect",
          title: "Thu tiền",
          due_date: d(-1),
          overdue: true,
        },
      },
    ]);
    await ok(call(c, P.hoa, "POST", `/obligations/${collect.id}/settle`, { at: d(0) }));
    expect((await detail(c, out.id)).stage).toBe("done");
  });
});
