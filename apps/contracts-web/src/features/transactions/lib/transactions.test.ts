// CR-097 G2 · GD-FR-01…05: logic thuần màn Giao dịch.
import { describe, expect, test } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import {
  actionsOf,
  EMPTY_FILTER,
  emptyForm,
  eventDetail,
  formTotal,
  hasFilter,
  lineAmount,
  linesToIn,
  listQuery,
  newLine,
  normQty,
  reasonOk,
  stockRows,
  toDraft,
  txErrorText,
} from "./transactions";

const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k);
const C1 = "c1000000-0000-4000-8000-000000000001";
const P1 = "e1000000-0000-4000-8000-000000000001";

describe("listQuery", () => {
  test("chỉ gửi trường có giá trị + trang/limit", () => {
    expect(listQuery(EMPTY_FILTER)).toBe("page=1&limit=20");
    const q = listQuery({ ...EMPTY_FILTER, status: "draft", deal: "buy", q: " Nam ", page: 3 });
    expect(q).toBe("status=draft&deal=buy&q=Nam&page=3&limit=20");
  });
  test("hasFilter", () => {
    expect(hasFilter(EMPTY_FILTER)).toBe(false);
    expect(hasFilter({ ...EMPTY_FILTER, from: "2026-10-01" })).toBe(true);
  });
});

describe("số lượng / tiền", () => {
  test("normQty", () => {
    expect(normQty("1,5")).toBe("1.5");
    expect(normQty(" 12 ")).toBe("12");
    expect(normQty("1.23456")).toBeNull();
    expect(normQty("abc")).toBeNull();
  });
  test("lineAmount làm tròn, sai ⇒ 0", () => {
    expect(lineAmount("2,5", "1.000")).toBe(2500);
    expect(lineAmount("x", "1000")).toBe(0);
    expect(lineAmount("2", "")).toBe(0);
  });
});

describe("form nháp", () => {
  const good = () => {
    const f = emptyForm("2026-10-27", "buy");
    f.partner_name = "  Bao Bì Nam ";
    f.lines = [
      { ...newLine(), name: "Thùng", qty: "10", price: "5.000", product_id: P1, component_id: C1 },
    ];
    return f;
  };
  test("form hợp lệ → thân API (cắt khoảng trắng, SP + thành phần)", () => {
    const r = toDraft(good());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.partner_name).toBe("Bao Bì Nam");
      expect(r.body.due_on).toBeNull();
      expect(r.body.lines[0]).toEqual({
        name: "Thùng",
        qty: "10",
        unit_price: 5000,
        product_id: P1,
        component_ids: [C1],
        unit: null,
      });
    }
  });
  test("thiếu đối tác / ngày / dòng / trường dòng", () => {
    expect(toDraft({ ...good(), partner_name: " " })).toEqual({ ok: false, error: "partner" });
    expect(toDraft({ ...good(), occurred_on: "" })).toEqual({ ok: false, error: "date" });
    expect(toDraft({ ...good(), lines: [] })).toEqual({ ok: false, error: "noLines" });
    const bad = { ...good(), lines: [{ ...newLine(), name: "A", qty: "0", price: "1" }] };
    expect(toDraft(bad)).toEqual({ ok: false, error: { line: 0, field: "qty" } });
    expect(linesToIn([{ ...newLine(), name: "A", qty: "1", price: "" }])).toEqual({
      ok: false,
      error: { line: 0, field: "price" },
    });
  });
  test("dòng không SP: không gửi product/component", () => {
    const r = linesToIn([
      { ...newLine(), name: "Phí vận chuyển", qty: "1", price: "200.000", component_id: C1 },
    ]);
    expect(r.ok && r.lines[0]).toMatchObject({
      product_id: null,
      component_ids: null,
      unit_price: 200000,
    });
  });
  test("formTotal", () => {
    expect(formTotal(good().lines)).toBe(50000);
  });
});

describe("thao tác theo trạng thái", () => {
  test("nháp / đã ghi sổ / đã huỷ / chỉ đọc", () => {
    expect(actionsOf("draft", true)).toMatchObject({
      edit: true,
      remove: true,
      post: true,
      adjust: false,
    });
    expect(actionsOf("posted", true)).toMatchObject({
      describe: true,
      adjust: true,
      cancel: true,
      edit: false,
    });
    expect(Object.values(actionsOf("cancelled", true)).some(Boolean)).toBe(false);
    expect(Object.values(actionsOf("draft", false)).some(Boolean)).toBe(false);
  });
});

describe("kho trước → sau", () => {
  test("xu hướng + nhãn", () => {
    const rows = stockRows(
      [
        {
          component_id: C1,
          on_hand_before: "10",
          on_hand_after: "4",
          avg_cost_before: 100,
          avg_cost_after: 100,
        },
        {
          component_id: P1,
          on_hand_before: "0",
          on_hand_after: "5.5",
          avg_cost_before: 0,
          avg_cost_after: 90,
        },
      ],
      new Map([[C1, "Thùng · Hộp"]]),
    );
    expect(rows[0]).toMatchObject({
      label: "Thùng · Hộp",
      trend: "down",
      before: "10",
      after: "4",
    });
    expect(rows[1]).toMatchObject({ label: "e1000000", trend: "up", costAfter: 90 });
  });
});

describe("lỗi", () => {
  const err = (status: number, code: string, msg = "m") => new ApiError(status, code as never, msg);
  test("STOCK/INVALID hiện nguyên văn máy chủ; STATE dùng khoá; khác = chung", () => {
    expect(txErrorText(err(409, "TRANSACTION_STOCK", "Thiếu 3 thùng"), t)).toBe("Thiếu 3 thùng");
    expect(txErrorText(err(422, "TRANSACTION_INVALID", "Dòng 2 sai"), t)).toBe("Dòng 2 sai");
    expect(txErrorText(err(409, "TRANSACTION_STATE"), t)).toBe("contracts.txn.errors.state");
    expect(txErrorText(err(404, "NOT_FOUND"), t)).toBe("contracts.txn.errors.notFound");
    expect(txErrorText(new Error("x"), t)).toBe("contracts.errors.unknown");
  });
  test("reasonOk 3–500", () => {
    expect(reasonOk("ab")).toBe(false);
    expect(reasonOk("  sai SL ")).toBe(true);
    expect(reasonOk("x".repeat(501))).toBe(false);
  });
});

test("eventDetail", () => {
  expect(eventDetail({ total: 1000, lines: 2 }, t)).toContain("contracts.txn.eventLines");
  expect(eventDetail({ fields: ["note", "holder"] }, t)).toBe("note, holder");
  expect(eventDetail({}, t)).toBe("");
});
