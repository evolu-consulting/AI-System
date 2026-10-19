// HD-FR-26 · S04/S05: luật thuần màn kiểm/sửa + form nhập tay (port `ContractPage.tsx` `changed`, `NewContractPage.tsx` `numbers`).
import { describe, expect, it } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { EMPTY_FORM, readNumbers, toRequest } from "../../contract-new/lib/new-form";
import { changedFields, draftOf, leadKey, SHOWN, unverified, warningsOf } from "./review";
import { saveErrorText } from "./save-error";

const field = (value: string | number | boolean | null, verified = true) => ({
  value,
  quote: "",
  verified,
  edited: false,
});
const c = {
  fields: {
    ...Object.fromEntries(SHOWN.map(([k]) => [k, field(null)])),
    number: field("HĐ-1"),
    total_value: field(245_000_000, false),
    end_date: field("2026-12-31"),
  },
  // biome-ignore lint/suspicious/noExplicitAny: dữ liệu thử rút gọn của ContractDetail
} as any;

describe("S05 · màn kiểm/sửa", () => {
  it("13 ô theo thứ tự mgmt-app; bản nháp từ giá trị đã lưu", () => {
    expect(SHOWN.map(([k]) => k)).toEqual([
      "number",
      "title",
      "supplier_name",
      "supplier_tax_id",
      "buyer_name",
      "buyer_tax_id",
      "supplier_representative",
      "buyer_representative",
      "start_date",
      "end_date",
      "notice_days",
      "total_value",
      "payment_terms",
    ]);
    const d = draftOf(c);
    expect([d.number, d.total_value, d.title]).toEqual(["HĐ-1", "245000000", ""]);
  });
  it("chỉ gửi ô đã đổi; số bỏ ký tự không phải số; xoá trắng ⇒ null", () => {
    const d = { ...draftOf(c), total_value: "250.000.000 đ", number: "  ", end_date: "2026-12-31" };
    expect(changedFields(c, d)).toEqual({ total_value: 250_000_000, number: null });
    expect(changedFields(c, draftOf(c))).toEqual({});
  });
  it("chưa kiểm chứng = có giá trị mà verified=false; trường rỗng không gắn", () => {
    expect(unverified(c, "total_value")).toBe(true);
    expect(unverified(c, "number")).toBe(false);
    expect(unverified(c, "title")).toBe(false);
  });
  it("cảnh báo: chỉ phần có message; dòng phụ theo trạng thái", () => {
    expect(
      warningsOf({ warnings: [{ field: null, code: "vat_unknown", message: "x" }, 1, null] }),
    ).toHaveLength(1);
    expect(leadKey("extracting")).toBe("contracts.review.reading");
    expect(leadKey("needs_review")).toBe("contracts.review.checkLead");
    expect(leadKey("active")).toBeNull();
  });
  it("câu lỗi lưu: 409 ⇒ conflict, mạng ⇒ network, còn lại ⇒ unknown (không lộ thông điệp máy chủ)", () => {
    const t = (k: string) => k;
    expect(saveErrorText(new ApiError(409, "HTTP_ERROR", "stale"), t)).toBe(
      "contracts.errors.conflict",
    );
    expect(saveErrorText(new ApiError(0, "NETWORK_ERROR", "x"), t)).toBe(
      "contracts.errors.network",
    );
    expect(saveErrorText(new Error("SELECT * secret"), t)).toBe("contracts.errors.unknown");
  });
});

describe("S04 · nhập tay", () => {
  it("đọc số kiểu Việt; ô sai ⇒ tên ô (dòng hàng kèm tên)", () => {
    const f = {
      ...EMPTY_FORM,
      total_value: "91.500.000",
      items: [
        { name: "Gạo", unit: "kg", qty: "1,5", unit_price: "abc" },
        { name: "", unit: "", qty: "x", unit_price: "" },
      ],
    };
    const n = readNumbers(f);
    expect(n.values).toEqual({ notice_days: 30, total_value: 91_500_000 });
    expect(n.bad).toEqual([{ key: "priceOf", name: "Gạo" }]);
  });
  it("thân gửi: rỗng ⇒ null, dòng không tên bị bỏ", () => {
    const f = {
      ...EMPTY_FORM,
      title: "HĐ gạo",
      partner_name: "A",
      items: [
        { name: "Gạo", unit: "", qty: "2", unit_price: "1.000" },
        { name: " ", unit: "", qty: "", unit_price: "" },
      ],
    };
    const body = toRequest(f, readNumbers(f));
    expect(body).toMatchObject({
      direction: "purchase",
      number: null,
      partner_tax_id: null,
      notice_days: 30,
    });
    expect(body.items).toEqual([{ name: "Gạo", unit: null, qty: 2, unit_price: 1000 }]);
  });
});
