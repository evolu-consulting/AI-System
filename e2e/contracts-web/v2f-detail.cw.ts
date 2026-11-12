// V2-F · HD-04 · HD-09 · HD-11 · Luật 4b: chi tiết hợp đồng — khối Sản phẩm (Nhập/Xuất kho, thành tiền + tổng). Backend giả `page.route`; chờ phần tử/yêu cầu,
// không sleep. CR-127 Q10b: khối Thông tin sửa-được (Lưu thay đổi) của HĐ đã duyệt, Dòng thời gian mốc (Thêm/Sửa/Xoá/Xác nhận xong) và thẻ Tóm tắt của máy cũ đã gỡ
// (HĐ done chỉ đọc; thực hiện = Nhận việc / Giao hàng: e2e/cr127 j04, j10).
import { expect, test } from "@playwright/test";
import { contractAsHub } from "./dataset-contract";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

test.describe("Sản phẩm", () => {
  for (const [deal, label] of [
    ["buy", "Nhập kho"],
    ["sell", "Xuất kho"],
    ["referral", "Không ảnh hưởng kho"],
  ] as const)
    test(`nhãn kho theo loại: ${deal} ⇒ ${label}`, async ({ page }) => {
      await installV2f(page, { contract: () => activeContract({ deal }) });
      await page.goto(`/contracts/c/${ACTIVE_ID}`);
      const panel = page.locator("section", { hasText: "Dòng trên hợp đồng" });
      await expect(panel.getByText(label, { exact: true })).toBeVisible();
    });

  test("bảng sản phẩm có thành tiền + tổng", async ({ page }) => {
    await installV2f(page);
    await page.goto(`/contracts/c/${ACTIVE_ID}`);
    await expect(page.getByTestId("products-total")).toHaveText("168.500.000");
  });

  test("HĐ chờ xác nhận (chưa theo dõi): không có dòng thời gian", async ({ page }) => {
    await installV2f(page, {
      contract: () => ({ ...contractAsHub("needs_review"), id: ACTIVE_ID }),
    });
    await page.goto(`/contracts/c/${ACTIVE_ID}`);
    await expect(page.getByRole("heading", { name: "Thông tin hợp đồng" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dòng thời gian" })).toHaveCount(0);
    // Bước xác nhận dùng thanh Huỷ/Lưu dính như form nhập tay.
    await expect(page.getByTestId("form-bar").getByRole("button", { name: "Lưu" })).toBeVisible();
  });
});
