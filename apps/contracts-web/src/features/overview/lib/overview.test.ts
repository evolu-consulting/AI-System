// nav-v2 · Tổng quan: luật thuần — nhóm trạng thái, số ngày còn lại, đối tác CHÚ Ý.
import { describe, expect, test } from "bun:test";
import type { BizProductRow, ContractFacets, RepPartnerRow, TodoItem } from "@ai/contracts";
import {
  barHeights,
  changeView,
  counterparty,
  daysLeft,
  EXPIRING_QS,
  groupCounts,
  inPeriod,
  moneyShort,
  partnersToReview,
  pctOf,
  suggestColumns,
  todoCanDone,
  todoTarget,
  todoWhen,
  topPartners,
  WORK_PREVIEW,
} from "./overview";

const facets = (status: { v: string; n: number }[]) => ({ status }) as unknown as ContractFacets;
const partner = (name: string, score: number | null, level: RepPartnerRow["level"]) =>
  ({ name, score, level, party: name, role: "customer", jobs: 5, groups: [] }) as RepPartnerRow;

describe("groupCounts", () => {
  test("gộp 9 trạng thái vào 3 nhóm và cộng tổng", () => {
    const g = groupCounts(
      facets([
        { v: "needs_review", n: 2 },
        { v: "extracting", n: 1 },
        { v: "active", n: 5 },
        { v: "expiring", n: 3 },
        { v: "expired", n: 4 },
        { v: "renewed", n: 1 },
      ]),
    );
    expect(g.counts).toEqual({ pending: 3, active: 8, done: 5 });
    expect(g.total).toBe(16);
  });
  test("chưa có dữ liệu ⇒ 0", () => {
    expect(groupCounts(undefined)).toEqual({
      total: 0,
      counts: { pending: 0, active: 0, done: 0 },
    });
  });
});

describe("daysLeft", () => {
  test("còn n ngày / hôm nay / đã quá, qua ranh giới tháng và năm", () => {
    expect(daysLeft("2026-12-01", "2026-10-20")).toBe(42);
    expect(daysLeft("2026-10-20", "2026-10-20")).toBe(0);
    expect(daysLeft("2026-10-18", "2026-10-20")).toBe(-2);
    expect(daysLeft("2027-01-02", "2026-12-30")).toBe(3);
  });
  test("thiếu ngày ⇒ null", () => {
    expect(daysLeft(null, "2026-10-20")).toBeNull();
    expect(daysLeft("2026-10-20", undefined)).toBeNull();
  });
});

describe("counterparty", () => {
  test("HĐ bán ⇒ bên mua; HĐ mua/không rõ ⇒ bên bán; trống ⇒ bên còn lại", () => {
    expect(counterparty({ direction: "sale", seller: "A", buyer: "B" })).toBe("B");
    expect(counterparty({ direction: "purchase", seller: "A", buyer: "B" })).toBe("A");
    expect(counterparty({ direction: null, seller: null, buyer: "B" })).toBe("B");
    expect(counterparty({ direction: null, seller: null, buyer: null })).toBe("");
  });
});

describe("partnersToReview", () => {
  test("chỉ mức CHÚ Ý, điểm thấp trước", () => {
    const rows = [
      partner("Beta", 63, "watch"),
      partner("Alpha", 80, "good"),
      partner("Gamma", 55, "watch"),
      partner("Delta", null, "new"),
    ];
    expect(partnersToReview(rows).map((p) => p.name)).toEqual(["Gamma", "Beta"]);
    expect(partnersToReview(undefined)).toEqual([]);
  });
});

describe("hằng số", () => {
  test("6 việc xem trước; truy vấn sắp hết hiệu lực sắp theo ngày hết hạn tăng dần", () => {
    expect(WORK_PREVIEW).toBe(6);
    expect(EXPIRING_QS).toContain("status=expiring");
    expect(EXPIRING_QS).toContain("sort=end_date&dir=asc");
  });
});

const todo = (o: Partial<TodoItem>) =>
  ({
    key: "k",
    kind: "overdue",
    days: 0,
    contract_id: null,
    product_id: null,
    party_key: null,
    ...o,
  }) as TodoItem;

describe("V2-N · định dạng & suy diễn", () => {
  test("moneyShort: tỷ / triệu / đồng", () => {
    expect(moneyShort(1_250_000_000)).toBe("1,25 tỷ");
    expect(moneyShort(236_000_000)).toBe("236,0 tr");
    expect(moneyShort(500)).toBe("500đ");
  });
  test("pctOf kẹp 0..100, dự kiến 0 ⇒ 0; changeView null ⇒ ẩn", () => {
    expect(pctOf(50, 200)).toBe(25);
    expect(pctOf(300, 200)).toBe(100);
    expect(pctOf(5, 0)).toBe(0);
    expect(changeView(null)).toBeNull();
    expect(changeView(-12.4)).toEqual({ up: false, n: 12 });
    expect(changeView(0)).toEqual({ up: true, n: 0 });
  });
  test("barHeights: cao nhất 100, có giá trị ≥ 6, trống 2; inPeriod = N tháng cuối", () => {
    expect(barHeights([0, 5, 100])).toEqual([2, 6, 100]);
    expect(barHeights([0, 0])).toEqual([2, 2]);
    expect([0, 9, 10, 11].map((i) => inPeriod(i, 12, "quarter"))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(inPeriod(11, 12, "month")).toBe(true);
    expect(inPeriod(10, 12, "month")).toBe(false);
  });
});

describe("V2-N · định dạng & suy diễn (todo)", () => {
  test("todoWhen: trễ / hôm nay / còn; đánh giá & thiếu file không có hạn", () => {
    expect(todoWhen(todo({ kind: "overdue", days: -3 }))).toEqual({ key: "late", n: 3 });
    expect(todoWhen(todo({ kind: "due_soon", days: 0 }))).toEqual({ key: "today", n: 0 });
    expect(todoWhen(todo({ kind: "contract_expiring", days: 12 }))).toEqual({ key: "left", n: 12 });
    expect(todoWhen(todo({ kind: "missing_file", days: -9 }))).toBeNull();
  });
  test("todoTarget: SP / đối tác / HĐ; chỉ gia hạn có Đã xong", () => {
    expect(
      todoTarget(todo({ kind: "customers_expiring", product_id: "p1", contract_id: "c1" })),
    ).toEqual({ to: "/products", sp: "p1", ht: "users" });
    expect(todoTarget(todo({ kind: "rating", party_key: "acme", contract_id: "c1" }))).toEqual({
      to: "/partners",
      party: "acme",
    });
    expect(todoTarget(todo({ kind: "rating_quarter" }))).toEqual({ to: "/partners" });
    expect(todoTarget(todo({ kind: "overdue", contract_id: "c1" }))).toEqual({
      to: "/contracts/$id",
      id: "c1",
    });
    expect(todoTarget(todo({ kind: "overdue" }))).toBeNull();
    expect(todoCanDone(todo({ kind: "renewal_contact" }))).toBe(true);
    expect(todoCanDone(todo({ kind: "overdue" }))).toBe(false);
  });
});

describe("V2-N · định dạng & suy diễn (cột gợi ý, đối tác)", () => {
  test("suggestColumns: 3 cột, điểm cao trước, bỏ SP chưa có điểm", () => {
    const p = (
      id: string,
      score: number | null,
      suggestion: BizProductRow["business"]["suggestion"],
    ) => ({ id, name: id, business: { score, suggestion } }) as BizProductRow;
    const cols = suggestColumns([
      p("a", 50, "buy"),
      p("b", 80, "push"),
      p("c", null, null),
      p("d", 10, "stop"),
    ]);
    expect(cols.map((c) => c.rows.map((r) => r.id))).toEqual([["b", "a"], [], ["d"]]);
  });
  test("topPartners: theo vai, nhiều việc trước, tối đa 3", () => {
    const r = (name: string, role: RepPartnerRow["role"], jobs: number) =>
      ({ name, party: name, role, jobs, score: 50, level: "fair", groups: [] }) as RepPartnerRow;
    const rows = [
      r("a", "supplier", 2),
      r("b", "supplier", 9),
      r("c", "supplier", 5),
      r("d", "supplier", 7),
      r("e", "customer", 3),
      r("f", "supplier", 0),
    ];
    expect(topPartners(rows, "supplier").map((p) => p.name)).toEqual(["b", "d", "c"]);
    expect(topPartners(rows, "customer").map((p) => p.name)).toEqual(["e"]);
  });
});
