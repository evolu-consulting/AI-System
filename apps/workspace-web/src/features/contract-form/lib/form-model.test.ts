// V2-F · HD-01 · 5.5a · Q15: luật thuần form hợp đồng — ô bắt buộc, dòng chưa gắn SP, giá trị tự cộng, đọc số kiểu Việt, thân POST /manual.
import { describe, expect, it } from "bun:test";
import {
  autoTotal,
  EMPTY_FORM,
  EMPTY_LINE,
  type FormState,
  lineTotal,
  missingRequired,
  NEW_PRODUCT,
  readNumbers,
  toRequest,
  unlinkedLines,
} from "./form-model";

const line = (o: Partial<typeof EMPTY_LINE>) => ({ ...EMPTY_LINE, ...o });
const base = (o: Partial<FormState> = {}): FormState => ({ ...EMPTY_FORM, ...o });

describe("ô bắt buộc (viền đỏ)", () => {
  it("form rỗng thiếu tên, đối tác, hiệu lực", () => {
    expect(missingRequired(base())).toEqual(["title", "partner_name", "start_date"]);
  });
  it("Giới thiệu cần % hoặc số tiền hoa hồng; có một trong hai là đủ", () => {
    const f = base({ deal: "referral", title: "A", partner_name: "B", start_date: "2026-01-01" });
    expect(missingRequired(f)).toEqual(["commission"]);
    expect(missingRequired({ ...f, commission_pct: "8" })).toEqual([]);
    expect(missingRequired({ ...f, commission_fixed: "5.000.000" })).toEqual([]);
  });
});

describe("5.5a · mọi dòng có tên phải gắn SP danh mục", () => {
  it("dòng trống bỏ qua; có tên mà chưa gắn ⇒ chặn; tạo mới thiếu tên SP ⇒ chặn", () => {
    const f = base({
      items: [
        line({ name: "Token", product_id: "p1" }),
        line({ name: "Đầu đọc" }),
        line({ name: "Gói", product_id: NEW_PRODUCT, new_name: " " }),
        line({ name: "Gói 2", product_id: NEW_PRODUCT, new_name: "Gói 2" }),
        line({}),
      ],
    });
    expect(unlinkedLines(f)).toEqual([1, 2]);
  });
});

describe("giá trị tự cộng khi để trống", () => {
  it("cộng SL × đơn giá của dòng có tên và tính được; không dòng nào tính được ⇒ null", () => {
    const items = [
      line({ name: "A", qty: "2", unit_price: "1.000" }),
      line({ name: "B", qty: "1,5", unit_price: "200" }),
      line({ name: "C", qty: "", unit_price: "9" }),
      line({ qty: "5", unit_price: "5" }),
    ];
    expect(lineTotal(items[1] as (typeof items)[number])).toBe(300);
    expect(autoTotal(items)).toBe(2300);
    expect(autoTotal([line({ name: "C" })])).toBeNull();
  });
  it("thân gửi: giá trị gõ tay thắng; để trống ⇒ tổng các dòng; Giới thiệu không gửi giá trị mà gửi hoa hồng", () => {
    const f = base({
      title: "HĐ",
      partner_name: "A",
      items: [line({ name: "Gạo", qty: "2", unit_price: "1.000" })],
    });
    const body = toRequest(f, readNumbers(f), ["p1"]);
    expect(body.total_value).toBe(2000);
    const typed = base({ ...f, total_value: "91.500.000" });
    expect(toRequest(typed, readNumbers(typed), ["p1"]).total_value).toBe(91_500_000);
    const ref = base({ ...f, deal: "referral", commission_pct: "8,5" });
    const rb = toRequest(ref, readNumbers(ref), ["p1"]);
    expect([rb.total_value, rb.commission_pct, rb.commission_fixed]).toEqual([null, 8.5, null]);
  });
});

describe("đọc số kiểu Việt + thân gửi", () => {
  it("ô sai ⇒ tên ô (dòng hàng kèm tên)", () => {
    const f = base({
      total_value: "91.500.000",
      items: [line({ name: "Gạo", unit: "kg", qty: "1,5", unit_price: "abc" }), line({ qty: "x" })],
    });
    const n = readNumbers(f);
    expect([n.notice_days, n.total_value]).toEqual([30, 91_500_000]);
    expect(n.bad).toEqual([{ key: "priceOf", name: "Gạo" }]);
  });
  it("% hoa hồng ngoài 0…100 ⇒ báo lỗi", () => {
    expect(readNumbers(base({ commission_pct: "120" })).bad).toEqual([{ key: "pctShort" }]);
  });
  it("rỗng ⇒ null, dòng không tên bị bỏ, product_id + component_ids đi kèm dòng", () => {
    const f = base({
      title: " HĐ gạo ",
      partner_name: "A",
      items: [
        line({ name: "Gạo", qty: "2", unit_price: "1.000", component_id: "c1" }),
        line({ name: " " }),
      ],
    });
    const body = toRequest(f, readNumbers(f), ["p1"]);
    expect(body).toMatchObject({
      deal: "buy",
      title: "HĐ gạo",
      number: null,
      partner_tax_id: null,
      notice_days: 30,
    });
    expect(body.items).toEqual([
      {
        name: "Gạo",
        unit: null,
        qty: 2,
        unit_price: 1000,
        product_id: "p1",
        component_ids: ["c1"],
      },
    ]);
    expect("commission_pct" in body).toBe(false);
  });
});
