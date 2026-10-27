import { describe, expect, test } from "bun:test";
import { EMPTY_DRAFT, metaFields, toUploadMeta } from "./upload-meta";

describe("toUploadMeta", () => {
  test("HĐ kinh tế mặc định: chỉ doc_type; chọn HĐ NT ⇒ kèm frame_root_id; bỏ qua hạn mức", () => {
    expect(toUploadMeta(EMPTY_DRAFT)).toEqual({ ok: true, meta: { doc_type: "contract" } });
    const withFrame = toUploadMeta({ ...EMPTY_DRAFT, frameId: "f1", creditLimit: "5" });
    expect(withFrame).toEqual({ ok: true, meta: { doc_type: "contract", frame_root_id: "f1" } });
  });
  test("HĐ nguyên tắc: hạn mức kiểu Việt + cách đặt hàng; để trống ⇒ không gửi; không mang frame", () => {
    expect(
      toUploadMeta({
        docType: "framework",
        frameId: "f1",
        creditLimit: "400.000.000",
        orderTerms: " Đặt qua email ",
      }),
    ).toEqual({
      ok: true,
      meta: { doc_type: "framework", credit_limit: 400_000_000, order_terms: "Đặt qua email" },
    });
    expect(toUploadMeta({ ...EMPTY_DRAFT, docType: "framework" })).toEqual({
      ok: true,
      meta: { doc_type: "framework" },
    });
  });
  test("hạn mức không đọc được ⇒ lỗi credit", () => {
    expect(toUploadMeta({ ...EMPTY_DRAFT, docType: "framework", creditLimit: "abc" })).toEqual({
      ok: false,
      error: "credit",
    });
  });
});

describe("metaFields", () => {
  test("chỉ các khoá có giá trị; vắng meta ⇒ không trường", () => {
    expect(metaFields(undefined)).toEqual([]);
    expect(metaFields({ doc_type: "framework", credit_limit: 0 })).toEqual([
      ["doc_type", "framework"],
      ["credit_limit", "0"],
    ]);
  });
});
