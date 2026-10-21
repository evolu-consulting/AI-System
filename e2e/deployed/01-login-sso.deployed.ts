// Luồng 1 · đăng nhập AI System (chat-web) rồi sang Sổ Hợp Tác (contracts-web) bằng app switcher/SSO — không đăng nhập lần hai.
import { bodyText, CHAT, CW, expect, login, settle, test, watchConsole } from "./_support";

test.describe("01 đăng nhập + SSO", () => {
  // portal-home: đăng nhập AI System hạ cánh ở TRANG CHỦ (không còn vào thẳng chat) — trừ khi người dùng/công ty đã đặt app mặc định
  // (tài khoản demo chưa đặt). Thẻ app theo /me/apps; Chat AI vẫn mở được.
  test("đăng nhập chat-web (AI System) vào trang chủ có thẻ app, mở được Chat AI", async ({
    page,
  }) => {
    await login(page, CHAT);
    await settle(page);
    await expect(page).toHaveURL(new RegExp(`^${CHAT}/?(\\?.*)?$`));
    await expect(page.getByTestId("portal-tiles")).toBeVisible();
    await expect(page.getByTestId("portal-tile-chat")).toBeVisible();
    await expect(page.getByTestId("portal-tile-contracts")).toBeVisible();
    await expect(page.getByTestId("portal-ask")).toBeVisible();
    expect(await bodyText(page)).toMatch(/Xin chào|Hello/);
    await page.getByTestId("portal-tile-chat").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/c\/new/);
    // chờ trang chào của chat (route nạp lười): ô "Hỏi AI" của portal cũng là textbox nên không dùng để chờ.
    await expect(page.getByRole("heading", { level: 1, name: /hôm nay cần gì/i })).toBeVisible();
    await expect(page.getByRole("textbox").last()).toBeVisible();
  });

  test("portal: /chat và /c/new vẫn vào chat; Hỏi AI điền sẵn câu hỏi", async ({ page }) => {
    await login(page, CHAT);
    await page.goto(`${CHAT}/chat`);
    await settle(page);
    await expect(page).toHaveURL(/\/c\/new/);
    await page.goto(`${CHAT}/`);
    await page.getByTestId("portal-ask").fill("E2E-DEPLOY-portal xin chào");
    await page.getByTestId("portal-ask").press("Enter");
    await expect(page).toHaveURL(/\/c\/new/);
    await expect(page.getByRole("textbox").last()).toHaveValue(/E2E-DEPLOY-portal/);
  });

  test("switcher: mục đầu tiên là Trang chủ AI System (cả từ app khác)", async ({ page }) => {
    await login(page, CHAT);
    await page.goto(`${CHAT}/c/new`);
    await page.getByRole("button", { name: /Ứng dụng|Apps/ }).click();
    await expect(page.getByRole("menuitem").first()).toContainText(
      /Trang chủ AI System|AI System home/,
    );
    await page.getByRole("menuitem").first().click();
    await expect(page).toHaveURL(new RegExp(`^${CHAT}/\\?home=1`));
    await expect(page.getByTestId("portal-tiles")).toBeVisible();
    // từ Sổ Hợp Tác quay về trang chủ qua SSO
    await page.getByRole("button", { name: /Ứng dụng|Apps/ }).click();
    await page.getByRole("menuitem", { name: /Sổ Hợp Tác/ }).click();
    await expect(page).toHaveURL(new RegExp(`^${CW}/(?!login)`));
    await page.getByRole("button", { name: /Ứng dụng|Apps/ }).click();
    await page.getByRole("menuitem", { name: /Trang chủ AI System|AI System home/ }).click();
    await expect(page).toHaveURL(new RegExp(`^${CHAT}/\\?home=1`));
    await expect(page.getByTestId("portal-tiles")).toBeVisible();
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

  // sso-switch: nút "Ứng dụng" ở thanh trên chat-web (từ trang chủ hoặc khung chat) ⇒ link Sổ Hợp Tác (/sso?app=contracts ⇒ mã một lần) ⇒ contracts-web đã đăng nhập.
  test("app switcher trong AI System mở Sổ Hợp Tác", async ({ page }) => {
    await login(page, CHAT);
    await page.getByRole("button", { name: /Ứng dụng|Apps/ }).click();
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
