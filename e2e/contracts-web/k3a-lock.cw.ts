// CR-097 K3a · HD-FR-100 · Luật 4b: danh sách — không còn «Thêm thủ công»; hàng đã xác nhận có 🔒. (CR-127 Q10b: banner khoá/«Mở lại»/
// «Chưa xác nhận» của máy cũ đã gỡ — HĐ done chỉ đọc, sửa = phiên bản mới: e2e/cr127 j05/j10.) Backend giả `page.route`; không sleep.
import { expect, test } from "@playwright/test";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

test("danh sách: không còn «Thêm thủ công»; hàng đã xác nhận có 🔒", async ({ page }) => {
  await installV2f(page);
  await page.goto("/contracts/list");
  await expect(page.getByRole("button", { name: "Tải hợp đồng lên" })).toBeVisible();
  await expect(page.getByText("Thêm thủ công")).toHaveCount(0);
  await expect(page.getByTestId("row-lock").first()).toBeVisible();
});
