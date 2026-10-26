// GAP-D2 · luật thuần: liên hệ nhiều người (#24), MST/lỗi công ty (#23), cảnh báo bất thường + đường xu hướng (#27).
import { describe, expect, it } from "bun:test";
import { PartnerContactsPutSchema } from "@ai/contracts";
import { companyErrKey, normalizeTax } from "./company";
import { blankRow, draftsOf, rowsOf, wireOf } from "./contacts";

describe("thân PUT liên hệ khớp hợp đồng API", () => {
  it("không gửi null (API nhận chuỗi/vắng khoá)", () => {
    const d = draftsOf([{ ...blankRow(), name: "Hưng", phone: "028" }]);
    if (!("ok" in d)) throw new Error("draft");
    const body = { party: "tax:0101000005", contacts: wireOf(d.ok) };
    const r = PartnerContactsPutSchema.safeParse(body);
    expect(r.success).toBe(true);
    expect(r.data?.contacts[0]).toEqual({
      name: "Hưng",
      role: null,
      phone: "028",
      email: null,
      our_owner: null,
    });
  });
});

describe("liên hệ nhiều người", () => {
  it("bỏ dòng trống, cắt chữ, rỗng ⇒ null, giữ thứ tự", () => {
    const a = { ...blankRow(), name: " Lan ", phone: "0903", our_owner: "Hoa" };
    const r = draftsOf([a, blankRow(), { ...blankRow(), name: "Minh", email: "m@x.vn" }]);
    expect(r).toEqual({
      ok: [
        { name: "Lan", role: null, phone: "0903", email: null, our_owner: "Hoa" },
        { name: "Minh", role: null, phone: null, email: "m@x.vn", our_owner: null },
      ],
    });
  });
  it("dòng có chữ mà thiếu tên ⇒ lỗi; quá 20 ⇒ lỗi; nạp lại từ máy chủ", () => {
    expect(draftsOf([{ ...blankRow(), phone: "1" }])).toEqual({ err: "missing_name", at: 0 });
    const many = Array.from({ length: 21 }, () => ({ ...blankRow(), name: "x" }));
    expect(draftsOf(many)).toMatchObject({ err: "too_many" });
    expect(
      rowsOf([{ id: "i", name: "A", role: null, phone: null, email: null, our_owner: null }])[0],
    ).toMatchObject({ key: "i", name: "A", role: "" });
  });
});

describe("thêm công ty", () => {
  it("chuẩn hoá MST: 10 / 13 (chi nhánh) / 12 số; sai dạng ⇒ null", () => {
    expect(normalizeTax(" 0301.234.567 ")).toBe("0301234567");
    expect(normalizeTax("0301234567001")).toBe("0301234567-001");
    expect(normalizeTax("0301234567-001")).toBe("0301234567-001");
    expect(normalizeTax("123456789012")).toBe("123456789012");
    expect(normalizeTax("12345")).toBeNull();
    expect(normalizeTax("03012345-67")).toBeNull();
    expect(normalizeTax("abc")).toBeNull();
  });
  it("mã lỗi ⇒ khoá câu báo", () => {
    expect(companyErrKey("COMPANY_EXISTS")).toBe("exists");
    expect(companyErrKey("COMPANY_INVALID")).toBe("invalid");
    expect(companyErrKey("TAX_UNAVAILABLE")).toBe("unavailable");
    expect(companyErrKey("X")).toBe("failed");
  });
});
