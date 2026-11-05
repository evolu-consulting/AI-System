// CR-121 C-3c · danh sách Công ty theo khuôn danh sách chung: phễu lọc Trạng thái → chip + n / tổng; bấm hàng mở ngăn tóm tắt
// (mã công ty, số người dùng, ứng dụng đang bật, trạng thái) + "Mở trang chi tiết" tới tab Hồ sơ. Chưa chạy (chạy cuối đợt).
import { expect, type Page, test } from "@playwright/test";
import { loginToShell, resetFixture, seedAdmin } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const openTenants = async (page: Page) => {
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
  await page.goto("/tenants");
  await expect(page.getByRole("table", { name: "Công ty" })).toBeVisible();
};

test("CR-121 · /tenants phễu lọc Đã khoá cho chip và n / tổng, bỏ chip thì đủ lại", async ({
  page,
}) => {
  await openTenants(page);
  await expect(page.getByRole("radio", { name: /^Đã khoá/ })).toHaveCount(0);
  const total = page.getByText(/^\d+ \/ \d+$/);
  await expect(total).toBeVisible();
  await page.getByRole("button", { name: "Lọc" }).click();
  await page.getByRole("menuitemradio", { name: /^Đã khoá/ }).click();
  await expect(page.getByRole("button", { name: /Bỏ lọc Trạng thái: Đã khoá/ })).toBeVisible();
  await expect(total).toHaveText(/^1 \/ \d+$/);
  await page.getByRole("button", { name: /Bỏ lọc Trạng thái: Đã khoá/ }).click();
  await expect(total).toHaveText(/^(\d+) \/ \1$/);
});

test("CR-121 · /tenants bấm hàng acme mở ngăn tóm tắt và Mở trang chi tiết tới tab Hồ sơ", async ({
  page,
}) => {
  await openTenants(page);
  await expect(page.getByRole("link", { name: "Thêm công ty" })).toBeVisible();
  await page.getByRole("row", { name: /acme/ }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("acme", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Đang hoạt động")).toBeVisible();
  await expect(drawer.getByText("Ứng dụng đang bật")).toBeVisible();
  await drawer.getByRole("link", { name: "Mở trang chi tiết" }).click();
  await expect(page).toHaveURL(/\/tenants\/[0-9a-f-]{36}\?.*tab=profile/);
  await expect(page.getByRole("tab", { name: "Hồ sơ" })).toHaveAttribute("aria-selected", "true");
});
