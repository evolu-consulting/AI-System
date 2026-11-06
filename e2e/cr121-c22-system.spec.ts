// CR-121 · c22 · màn "Hệ thống" (`/system`): tenant_admin vào từ sidebar, thấy Chi phí · Nhật ký · Góp ý (không thấy Secrets/Nguồn/Bước DLC),
// bấm Chi phí sang `/usage`; platform_admin thấy đủ mục. Chỉ đọc, không tạo dữ liệu.
import { expect, test } from "@playwright/test";
import { loginAdmin, loginAs, resetFixture } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => resetFixture());
test.afterAll(() => resetFixture());

test("CR-121 · tenant_admin: Hệ thống → Chi phí, chỉ thấy các mục của công ty mình", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.getByRole("navigation").getByRole("link", { name: "Hệ thống" }).click();
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole("heading", { level: 1, name: "Hệ thống" })).toBeVisible();
  const hub = page.getByTestId("system-hub");
  for (const name of ["Chi phí & quota", "Nhật ký", "Góp ý"]) {
    await expect(hub.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
  for (const name of ["Secrets", "Nguồn", "Bước DLC", "Import / Export", "Tình trạng hệ thống"]) {
    await expect(hub.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
  }
  await hub.getByRole("link", { name: /Chi phí/ }).click();
  await expect(page).toHaveURL(/\/usage/);
});

test("CR-121 · platform_admin: Hệ thống có đủ lối vào quản trị chung", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/system");
  const hub = page.getByTestId("system-hub");
  for (const name of ["Chi phí & quota", "Nhật ký", "Góp ý", "Tình trạng hệ thống", "Secrets"]) {
    await expect(hub.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
});
