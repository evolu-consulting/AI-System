// PK-FR-10 · D-02 · N1 plan-frontend §1 (Đăng nhập S01, Phiên/token, guard) §7 (nhãn): e2e đăng nhập `contracts-web`.
// Nhãn nguyên văn plan-frontend §7: heading "Đăng nhập", textbox "Email", textbox "Mật khẩu", button "Hiện mật khẩu"/"Ẩn mật khẩu",
// button "Đăng nhập", textbox "Mã công ty" (chỉ khi chưa biết tenant). Backend giả (`_support.ts`); không sleep.
import { expect, test } from "@playwright/test";
import { installBackend } from "./_support";

test.describe("PK-FR-10 · đăng nhập contracts-web (S01)", () => {
  test("PK-FR-10 · chưa có phiên: vào /contracts ⇒ chuyển /login?next=%2Fcontracts, có heading và form", async ({
    page,
  }) => {
    await installBackend(page, { session: false });
    await page.goto("/contracts");
    await expect(page).toHaveURL(/\/login\?next=%2Fcontracts$/);
    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Mật khẩu" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
  });

  test("PK-FR-10 · nhập đúng ⇒ vào trang theo next (/partners), token Bearer được gửi cho /pack/contracts/me", async ({
    page,
  }) => {
    const be = await installBackend(page, { session: false });
    await page.goto("/login?next=%2Fpartners&tenant=acme");
    await page.getByRole("textbox", { name: "Email" }).fill("lan");
    await page.getByRole("textbox", { name: "Mật khẩu" }).fill("Mat-khau-dung-1");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page).toHaveURL(/\/partners$/);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    expect(be.logins()).toEqual([
      { tenant_key: "acme", username: "lan", password: "Mat-khau-dung-1" },
    ]);
    expect(be.lastAuth()).toBe("Bearer e2e.access.token");
  });

  test("PK-FR-10 · sai mật khẩu ⇒ ở lại /login, hiện lỗi, không vào shell", async ({ page }) => {
    await installBackend(page, { session: false });
    await page.goto("/login?tenant=acme");
    await page.getByRole("textbox", { name: "Email" }).fill("lan");
    await page.getByRole("textbox", { name: "Mật khẩu" }).fill("sai-mat-khau");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toHaveCount(0);
  });

  test("PK-FR-10 · ô 'Mã công ty' chỉ hiện khi chưa biết tenant (?tenant= vắng ⇒ hiện, có ⇒ ẩn)", async ({
    page,
  }) => {
    await installBackend(page, { session: false });
    await page.goto("/login");
    await expect(page.getByRole("textbox", { name: "Mã công ty" })).toBeVisible();
    await page.goto("/login?tenant=acme");
    await expect(page.getByRole("textbox", { name: "Mã công ty" })).toHaveCount(0);
  });

  test("PK-FR-10 · 'Hiện mật khẩu' đổi sang 'Ẩn mật khẩu' và đổi type của ô mật khẩu", async ({
    page,
  }) => {
    await installBackend(page, { session: false });
    await page.goto("/login?tenant=acme");
    const pw = page.getByRole("textbox", { name: "Mật khẩu" });
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Hiện mật khẩu" }).click();
    await expect(pw).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Ẩn mật khẩu" })).toBeVisible();
  });

  test("PK-FR-10 · nav-v2 · đã có phiên (refresh cookie còn hạn): vào /login ⇒ chuyển /overview, không hiện form", async ({
    page,
  }) => {
    await installBackend(page, { session: true });
    await page.goto("/login");
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toHaveCount(0);
  });

  test("PK-FR-10 · hết phiên giữa chừng (/me 401): về /login?next= và báo bằng toast/alert", async ({
    page,
  }) => {
    const be = await installBackend(page, { session: true });
    await page.goto("/contracts");
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    be.setPack("unauthorized");
    await page.reload();
    await expect(page).toHaveURL(/\/login\?next=%2Fcontracts$/);
  });

  test("PK-FR-10 · ngôn ngữ: giao diện đăng nhập có bản EN (locale 'en' ⇒ heading 'Sign in')", async ({
    page,
    context,
  }) => {
    await installBackend(page, { session: false });
    await context.addInitScript(() => localStorage.setItem("ai.locale", "en"));
    await page.goto("/login?tenant=acme");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
