// CR-181 · s5 · Cài đặt › Chữ ký: quản trị bật «Ký trên tài liệu» (có hộp xác nhận), đổi màu mực, lưu; nhân viên (khác người cấu hình) thấy form khoá.
// Mở hộp thoại bằng URL `/settings/signature` (đích của chuông «Xin đổi») ⇒ `/contracts/settings?sec=signature` ⇒ hộp thoại Cài đặt ở mục «Chữ ký».
// Viết theo khuôn e2e/cr127/*; chưa chạy (điều phối chạy cuối đợt).

import { envOf, expect, loginCw, newPage, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j03);

test("Quản trị bật ký trên tài liệu, đổi màu mực, lưu", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.director);
  await page.goto("/settings/signature");
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await expect(dlg.getByRole("heading", { name: "Chữ ký" })).toBeVisible();

  await dlg.getByRole("switch", { name: "Ký trên tài liệu" }).click();
  await page.getByRole("button", { name: "Bật ký trên tài liệu" }).click();
  await dlg.getByRole("radio", { name: "Đen" }).click();
  await dlg.getByRole("button", { name: "Lưu định dạng" }).click();
  await expect(page.getByText("Đã lưu định dạng chữ ký")).toBeVisible();

  await page.reload();
  await page.goto("/settings/signature");
  await expect(dlg.getByRole("switch", { name: "Ký trên tài liệu" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(dlg.getByRole("radio", { name: "Đen" })).toBeChecked();
  await expect(dlg.getByRole("button", { name: "Bật chữ ký số" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("Nhân viên thấy form khoá «Chỉ quản trị công ty sửa»", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto("/settings/signature");
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  await expect(dlg.getByText("Chỉ quản trị công ty sửa").first()).toBeVisible();
  await expect(dlg.getByRole("radio", { name: "Đen" })).toBeDisabled();
  await expect(dlg.getByRole("button", { name: "Lưu định dạng" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
