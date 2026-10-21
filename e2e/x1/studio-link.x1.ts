// X1-AC13 (e2e) · HUB-FR-72 · app-catalog: Studio nằm trong switcher "Ứng dụng" dùng chung, chỉ cho platform_admin (catalog audience=platform).
// admin-api khởi động với `APP_URL_STUDIO=http://localhost:3200/studio/` (config x1). Vắng env: `e2e/x1-studio-link.spec.ts` (config gốc).
import { expect, type Page, test } from "@playwright/test";
import { loginAdmin, loginAs, SETUP } from "./_support";

test.beforeEach(SETUP);

const apps = (page: Page) => page.getByRole("button", { name: "Ứng dụng" });
const studio = (page: Page) => page.getByRole("menuitem", { name: "Studio" });

test("X1-AC13 · platform_admin thấy mục Studio trong Ứng dụng, trỏ tới URL catalog", async ({
  page,
}) => {
  await loginAdmin(page);
  await apps(page).click();
  await expect(studio(page)).toBeVisible();
  await expect(studio(page)).toHaveAttribute("href", /^http:\/\/localhost:3200\/studio\/?$/);
});

test("X1-AC13 · tenant_admin (binh) KHÔNG thấy Studio (không có switcher nào để mở)", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await expect(apps(page)).toHaveCount(0);
  await expect(studio(page)).toHaveCount(0);
});

test("X1-AC13 · màn 600px: nút Ứng dụng vẫn có tên và mở được Studio", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await loginAdmin(page);
  await apps(page).click();
  await expect(studio(page)).toBeVisible();
});
