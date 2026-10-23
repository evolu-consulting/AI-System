import { describe, expect, test } from "bun:test";
import { afterConfirmSave, confirmSaveBody, needsLinkDialog } from "./confirm-save";

const ITEM = "e2000000-0000-4000-8000-000000000001";

describe("atomic-confirm · Xác nhận và lưu (tắt duyệt)", () => {
  test("thân lệnh: có lựa chọn ⇒ version + products; không ⇒ chỉ version (không draft)", () => {
    const links = [
      { item_id: ITEM, new_product: { name: "Thùng", unit: "thùng", group: "goods" as const } },
    ];
    expect(confirmSaveBody(7, links)).toEqual({ version: 7, products: links });
    expect(confirmSaveBody(7, [])).toEqual({ version: 7 });
    expect("draft" in confirmSaveBody(7, links)).toBe(false);
  });
  test("hộp Gắn SP chỉ khi HĐ có dòng", () => {
    expect(needsLinkDialog(0)).toBe(false);
    expect(needsLinkDialog(2)).toBe(true);
  });
  test("thành công ⇒ đóng hộp + tải lại; HĐ đổi / không còn chờ ⇒ đóng + tải lại; lỗi SP ⇒ giữ hộp", () => {
    expect(afterConfirmSave({ ok: true })).toEqual({ close: true, refetch: true, toast: null });
    for (const code of ["REVIEW_NOT_ALLOWED", "CONTRACT_STALE"])
      expect(afterConfirmSave({ ok: false, code })).toMatchObject({ close: true, refetch: true });
    expect(afterConfirmSave({ ok: false, code: "PRODUCT_INVALID" })).toMatchObject({
      close: false,
      refetch: false,
    });
  });
});
