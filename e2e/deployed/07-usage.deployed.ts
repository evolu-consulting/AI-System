// Luồng 7 · ADM-FR-42 usage-analytics trên máy chủ: platform admin mở Chi phí & quota → "Phân tích token", lọc tenant demo,
// thấy token > 0 (chỉ đọc, không ghi dữ liệu). Cần tài khoản platform admin: e2e-deployed.ps1 -User <platform-admin>
// (+ `$env:DEP_TENANT` = mã công ty của tài khoản đó nếu khác `demo`).
import type { Page } from "@playwright/test";
import { ADMIN, expect, password, settle, TENANT, test, USER } from "./_support";

const LOGIN_TENANT = process.env.DEP_TENANT ?? TENANT;

async function loginAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await tenant.count()) await tenant.fill(LOGIN_TENANT);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill(USER);
  await pw.fill(password());
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 });
}

test.describe("07 usage-analytics (platform admin)", () => {
  test("Phân tích token: lọc tenant demo ⇒ token > 0", async ({ browser }) => {
    const ctx = await browser.newContext({
      locale: "vi-VN",
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    const page = await ctx.newPage();
    try {
      await loginAdmin(page);
      await settle(page);
      await page.goto(`${ADMIN}/usage/analytics?preset=90d`);
      // tenant-admin-scope (2026-10-21): phân tích token chỉ dành cho platform admin; tenant_admin (demo-owner) thấy trang "không có quyền".
      const title = page.getByRole("heading", { level: 1, name: "Phân tích token" });
      const denied = page.getByRole("heading", {
        level: 1,
        name: "Bạn không có quyền xem trang này",
      });
      await expect(title.or(denied)).toBeVisible({ timeout: 30_000 });
      if (await denied.isVisible()) {
        await expect(page.locator("main")).toContainText("chỉ dành cho quản trị nền tảng");
        test.skip(
          true,
          `${USER} là tenant_admin: đã kiểm trang bị chặn; cần -User <platform-admin> để kiểm token`,
        );
      }
      const picker = page.getByRole("combobox", { name: "Tenant" });
      test.skip(
        (await picker.count()) === 0,
        `${USER} không phải platform admin (-User <platform-admin>)`,
      );
      const resp = page.waitForResponse(
        (r) => r.url().includes("/admin/usage/analytics") && r.url().includes("tenant_id="),
      );
      await picker.click();
      await page.getByRole("option", { name: "demo", exact: true }).click();
      const body = (await (await resp).json()) as { kpi: { tokens: number; calls: number } };
      expect(body.kpi.calls).toBeGreaterThan(0);
      expect(body.kpi.tokens).toBeGreaterThan(0);
      const input = page.getByRole("region", { name: "Token vào", exact: true });
      await expect(input).not.toContainText(/^Token vào\s*0$/);
    } finally {
      await ctx.close();
    }
  });
});
