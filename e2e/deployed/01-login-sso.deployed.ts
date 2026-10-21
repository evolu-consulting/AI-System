// Luồng 1 · đăng nhập AI System (chat-web) rồi sang Sổ Hợp Tác (contracts-web) bằng app switcher/SSO — không đăng nhập lần hai.
import { bodyText, CHAT, CW, expect, login, settle, test, watchConsole } from "./_support";

test.describe("01 đăng nhập + SSO", () => {
  test("đăng nhập chat-web (AI System) vào trang hỏi AI", async ({ page }) => {
    await login(page, CHAT);
    await settle(page);
    await expect(page).toHaveURL(/\/c\//);
    await expect(page.getByRole("textbox").last()).toBeVisible();
    expect(await bodyText(page)).toMatch(/Chào Demo|hôm nay cần gì/i);
  });

  test("đăng nhập sai mật khẩu ⇒ thông báo, không vào được", async ({ page }) => {
    await page.goto(`${CHAT}/login`);
    const pw = page.locator("input[type=password]").first();
    await pw.waitFor();
    const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
    if (await tenant.count()) await tenant.fill("demo");
    await page
      .getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ })
      .fill("demo-owner");
    await pw.fill("E2E-DEPLOY-sai-mat-khau-1");
    await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  // sso-switch: nút "Ứng dụng" ở thanh bên chat-web ⇒ link Sổ Hợp Tác (/sso?app=contracts ⇒ mã một lần) ⇒ contracts-web đã đăng nhập.
  test("app switcher trong AI System mở Sổ Hợp Tác", async ({ page }) => {
    await login(page, CHAT);
    await page.getByRole("button", { name: /Ứng dụng|Apps|Sổ Hợp Tác/ }).click();
    await page.getByRole("menuitem", { name: /Sổ Hợp Tác/ }).click();
    await expect(page).toHaveURL(new RegExp(`^${CW}/(?!login)`));
    await expect(page.getByRole("link", { name: "Tổng quan" }).first()).toBeVisible();
  });

  // sso-switch: contracts-web chưa có phiên ⇒ dội về AI System (/sso) ⇒ mã một lần ⇒ phiên contracts riêng, không hỏi mật khẩu.
  test("sang contracts-web sau khi đăng nhập chat-web KHÔNG phải đăng nhập lại", async ({
    page,
  }) => {
    await login(page, CHAT);
    await page.goto(`${CW}/`);
    await settle(page);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("link", { name: "Tổng quan" }).first()).toBeVisible();
  });

  test("contracts-web: đăng nhập trực tiếp vào Tổng quan, không lỗi console", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CW);
    const errs = watchConsole(page);
    await settle(page);
    await expect(page).toHaveURL(/\/overview/);
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
    expect(errs.list).toEqual([]);
  });
});
