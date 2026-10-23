// app-perm · công ty demo chỉ dùng Sổ Hợp Tác (platform_admin đã thu hồi entitlement `chat-app`): đăng nhập ở AI System (ai.*)
// hạ cánh thẳng Sổ Hợp Tác; switcher chỉ có Sổ Hợp Tác (không Chat AI, không "Trang chủ AI System", không Quản trị với member);
// mở đường chat cũ (`/c/new`, `/chat`) cũng bị đưa về Sổ Hợp Tác. Tài khoản: env DEMO_SHT_TENANT / DEMO_SHT_USER, mật khẩu DEMO_PW.
// Cấu hình công ty demo: docs/specs/app-perm/tasks.md "Dựng công ty demo".
import type { Page } from "@playwright/test";
import { CHAT, CW, expect, password, settle, test } from "./_support";

const TENANT = process.env.DEMO_SHT_TENANT ?? "";
const USER = process.env.DEMO_SHT_USER ?? "";

async function loginDemo(page: Page): Promise<void> {
  await page.goto(`${CHAT}/login`);
  const pw = page.locator("input[type=password]").first();
  await pw.waitFor({ timeout: 45_000 });
  const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
  if (await tenant.count()) await tenant.fill(TENANT);
  await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill(USER);
  await pw.fill(password());
  await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
}

test.describe("14 app-perm · công ty chỉ Sổ Hợp Tác", () => {
  test.skip(!TENANT || !USER, "DEMO_SHT_TENANT / DEMO_SHT_USER chưa đặt");

  test("đăng nhập AI System ⇒ vào thẳng Sổ Hợp Tác; switcher chỉ có Sổ Hợp Tác", async ({
    page,
  }) => {
    await loginDemo(page);
    await page.waitForURL((u) => u.href.startsWith(CW) && !u.pathname.startsWith("/login"), {
      timeout: 45_000,
    });
    await settle(page);
    await page.getByRole("button", { name: /Ứng dụng|Apps/ }).click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(/Sổ Hợp Tác|Cooperation Ledger/);
    await expect(page.getByRole("menuitem", { name: /Chat AI|AI Chat/ })).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: /Trang chủ AI System|AI System home/ }),
    ).toHaveCount(0);
  });

  test("đường chat cũ và trang chủ ?home=1 ⇒ về Sổ Hợp Tác, không báo lỗi", async ({ page }) => {
    await loginDemo(page);
    await page.waitForURL((u) => u.href.startsWith(CW), { timeout: 45_000 });
    for (const path of ["/c/new", "/chat", "/?home=1"]) {
      await page.goto(`${CHAT}${path}`);
      await page.waitForURL((u) => u.href.startsWith(CW) && !u.pathname.startsWith("/login"), {
        timeout: 45_000,
      });
    }
  });
});
