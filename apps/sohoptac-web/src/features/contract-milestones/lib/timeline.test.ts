// V2-F · HD-04/HD-11: luật thuần dòng thời gian mốc + hộp Thêm/Sửa mốc.
import { describe, expect, it } from "bun:test";
import type { Milestone } from "@ai/contracts";
import { bodyOf, newDraft, withKind } from "./milestone-form";
import {
  buildTimeline,
  currentOverdue,
  daysBetween,
  defaultOwner,
  metaOf,
  milestoneState,
  progressOf,
} from "./timeline";

const TODAY = "2026-10-20";
let n = 0;
const ms = (o: Partial<Milestone>): Milestone => ({
  id: `m${++n}`,
  contract_id: "c",
  kind: "delivery",
  title: "Giao hàng",
  seq: n,
  due_date: "2026-10-25",
  owner: "ours",
  qty: null,
  amount: null,
  amount_effective: null,
  status: "open",
  confirmed: false,
  done_at: null,
  fault: null,
  postponed_to: null,
  source: "manual",
  ...o,
});

describe("trạng thái từng mốc", () => {
  it("xong đúng hạn / sớm / trễ; bước hiện tại; quá hạn; sắp tới", () => {
    const early = ms({ confirmed: true, status: "done", done_at: "2026-10-23" });
    const late = ms({ confirmed: true, status: "done", done_at: "2026-10-28" });
    const cur = ms({});
    const over = ms({ due_date: "2026-10-10" });
    expect(milestoneState(early, cur.id, TODAY)).toBe("done");
    expect(metaOf("done", -2)).toEqual({ key: "doneEarly", n: 2 });
    expect(metaOf("done", 0)).toEqual({ key: "doneOnTime", n: 0 });
    expect(milestoneState(late, cur.id, TODAY)).toBe("late");
    expect(metaOf("late", 3)).toEqual({ key: "doneLate", n: 3 });
    expect(milestoneState(cur, cur.id, TODAY)).toBe("cur");
    expect(milestoneState(over, cur.id, TODAY)).toBe("over");
    expect(milestoneState(ms({ due_date: "2026-11-30" }), cur.id, TODAY)).toBe("up");
    expect(metaOf("over", 10)).toEqual({ key: "dueOver", n: 10 });
    expect(metaOf("up", -5)).toEqual({ key: "dueLeft", n: 5 });
  });
  it("ngày giữa hai mốc theo lịch", () => {
    expect(daysBetween("2026-10-20", "2026-10-25")).toBe(5);
    expect(daysBetween("2026-10-25", "2026-10-20")).toBe(-5);
  });
});

describe("dựng dòng thời gian", () => {
  it("Ký → mốc theo hạn (bỏ mốc huỷ) → Hết hiệu lực; bước hiện tại đỏ khi quá hạn", () => {
    const a = ms({ due_date: "2026-10-30", title: "B" });
    const b = ms({ due_date: "2026-10-10", title: "A" });
    const gone = ms({ status: "cancelled" });
    const c = {
      start_date: "2026-10-01",
      end_date: "2027-10-01",
      milestones: [a, gone, b],
      next_milestone_id: b.id,
    };
    const nodes = buildTimeline(c, TODAY);
    expect(nodes.map((x) => (x.type === "milestone" ? x.m.title : x.type))).toEqual([
      "start",
      "A",
      "B",
      "end",
    ]);
    expect(currentOverdue(c, TODAY)).toBe(true);
    expect(currentOverdue({ ...c, next_milestone_id: a.id }, TODAY)).toBe(false);
  });
  it("tiến độ n/m: bỏ Nhắc gia hạn và mốc huỷ", () => {
    const list = [
      ms({ confirmed: true, status: "done" }),
      ms({}),
      ms({ kind: "renewal" }),
      ms({ status: "cancelled" }),
    ];
    expect(progressOf(list)).toEqual({ done: 1, total: 2, pct: 50 });
    expect(progressOf([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe("hộp Thêm / Sửa mốc", () => {
  it("việc của ai theo loại ≡ máy chủ", () => {
    expect(defaultOwner("delivery", "buy")).toBe("partner");
    expect(defaultOwner("delivery", "sell")).toBe("ours");
    expect(defaultOwner("collect", "sell")).toBe("partner");
    expect(defaultOwner("pay", "buy")).toBe("ours");
    expect(defaultOwner("commission", "referral")).toBe("partner");
  });
  it("đổi loại: xoá SL/tiền không hợp loại; giữ tên người dùng đã sửa", () => {
    const d0 = { ...newDraft("sell", TODAY, "Giao hàng"), qty: "5", title: "Giao đợt 2" };
    const pay = withKind(d0, "pay", "sell", "Thanh toán", true);
    expect([pay.qty, pay.title, pay.owner]).toEqual(["", "Giao đợt 2", "ours"]);
    const col = withKind({ ...pay, amount: "100" }, "delivery", "sell", "Giao hàng", false);
    expect([col.amount, col.title]).toEqual(["", "Giao hàng"]);
  });
  it("thân gửi: cần tên + hạn; số đọc kiểu Việt; số sai ⇒ lỗi", () => {
    const d = { ...newDraft("buy", TODAY, "Giao hàng"), qty: "1,5" };
    expect(bodyOf({ ...d, title: " " })).toEqual({ err: "needTitleDue" });
    expect(bodyOf({ ...d, qty: "abc" })).toEqual({ err: "badNumber" });
    expect(bodyOf(d)).toEqual({
      ok: {
        kind: "delivery",
        title: "Giao hàng",
        due_date: TODAY,
        owner: "partner",
        qty: 1.5,
        amount: null,
      },
    });
    const money = withKind(d, "collect", "buy", "Thu tiền", false);
    expect(bodyOf({ ...money, amount: "118.000.000" })).toMatchObject({
      ok: { qty: null, amount: 118_000_000 },
    });
  });
});
