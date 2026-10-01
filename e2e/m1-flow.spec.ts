// ADM-FR-01, ADM-FR-60, ADM-FR-04 · e2e luồng nghiệm thu M1 (test-plan E4; M1-AC08).
import { expect, test } from "@playwright/test";
import { fillLogin, loginToShell, resetFixture, seedAdmin } from "./support/helpers";

test.beforeAll(() => {
  resetFixture();
});

test("ADM-FR-01 · M1-AC08 · admin seed → Tenants → tạo tenant → mật khẩu tạm một lần → đăng xuất → đăng nhập tenant mới phải đổi mật khẩu", async ({
  page,
}) => {
  const admin = seedAdmin();
  await loginToShell(page, "platform", admin.username, admin.password);
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Tenants" }).click();
  await page.getByRole("link", { name: "+ Tạo tenant" }).click();

  await page.getByRole("textbox", { name: "Mã công ty" }).fill("umbrella");
  await page.getByRole("textbox", { name: "Tên công ty" }).fill("Umbrella Corp");
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill("wesker");
  await page.getByRole("textbox", { name: "Tên hiển thị" }).fill("Albert Wesker");
  await page.getByRole("textbox", { name: "Email" }).fill("wesker@umbrella.test");
  await page.getByRole("button", { name: "Tạo tenant", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Đã tạo tenant umbrella" });
  await expect(dialog).toBeVisible();
  const temp = dialog.getByRole("textbox", { name: "Mật khẩu tạm" });
  await expect(temp).toHaveValue(/^[A-Za-z0-9]{16}$/);
  const tempPassword = await temp.inputValue();
  await dialog.getByRole("checkbox", { name: "Tôi đã lưu mật khẩu tạm" }).check();
  await dialog.getByRole("button", { name: "Đi tới tenant" }).click();
  await expect(page).toHaveURL(/\/tenants\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Tài khoản của bạn" }).click();
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login/);

  await fillLogin(page, "umbrella", "wesker", tempPassword);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/change-password/);
  await expect(page.getByRole("heading", { name: "Đặt mật khẩu mới" })).toBeVisible();
});
