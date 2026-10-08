// X1-AC13 (e2e) · HUB-FR-72 · nút "⇄ Agent Forge" ở Topbar chỉ cho platform_admin (plan-frontend §2.5).
// Build có `PUBLIC_STUDIO_URL=http://localhost:3200/studio/` (config x1). Vắng env: `e2e/x1-studio-link.spec.ts` (config gốc).
import { expect, type Page, test } from "@playwright/test";
import { loginAdmin, loginAs, SETUP } from "./_support";

test.beforeEach(SETUP);

const link = (page: Page) => page.getByRole("link", { name: "Agent Forge" });

test("X1-AC13 · platform_admin thấy link 'Agent Forge' trỏ tới PUBLIC_STUDIO_URL", async ({
  page,
}) => {
  await loginAdmin(page);
  await expect(link(page)).toBeVisible();
  await expect(link(page)).toHaveAttribute("href", /^http:\/\/localhost:3200\/studio\/?$/);
});

test("X1-AC13 · tenant_admin (binh) KHÔNG thấy link 'Agent Forge'", async ({ page }) => {
  await loginAs(page, "acme", "binh");
  await expect(link(page)).toHaveCount(0);
});

test("X1-AC13 · màn 600px: chỉ còn icon nhưng link vẫn có tên 'Agent Forge'", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await loginAdmin(page);
  await expect(link(page)).toBeVisible();
  const box = await link(page).boundingBox();
  expect(box?.width ?? 999).toBeLessThanOrEqual(48);
});
