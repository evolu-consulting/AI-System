// X1-AC13 (e2e, config gốc: build admin-web KHÔNG có PUBLIC_STUDIO_URL) · HUB-FR-72 · vắng env ⇒ không có nút "⇄ Agent Forge",
// kể cả platform_admin. Bản có env + phân quyền theo vai trò: `e2e/x1/studio-link.x1.ts`.
import { expect, test } from "@playwright/test";
import { loginAdmin, resetFixture } from "./support/helpers";

test.beforeAll(() => {
  resetFixture();
});

test("X1-AC13 · vắng PUBLIC_STUDIO_URL: platform_admin KHÔNG thấy link 'Agent Forge'", async ({
  page,
}) => {
  await loginAdmin(page);
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
  // app-catalog: catalog không có URL nào (admin-api không có APP_URL_*) ⇒ switcher "Ứng dụng" ẩn, không có mục Studio.
  await expect(page.getByRole("button", { name: "Ứng dụng" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Studio" })).toHaveCount(0);
});
