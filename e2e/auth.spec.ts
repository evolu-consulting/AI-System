// ADM-FR-01, ADM-FR-03, ADM-FR-06, ADM-FR-07 · e2e đăng nhập, đổi mật khẩu, phiên (test-plan E1; M1-AC06).
import { expect, type Page, test } from "@playwright/test";
import {
  fillLogin,
  loginToShell,
  loginUI,
  logoutUI,
  PW,
  resetFixture,
  seedAdmin,
  TEMP_PW,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const submit = (page: Page) => page.getByRole("button", { name: "Đăng nhập", exact: true });
const loginResponse = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/auth/login") && r.request().method() === "POST");

test("ADM-FR-01 · M1-R22 · /login có heading level 1 'Đăng nhập'", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập" })).toBeVisible();
});

test("ADM-FR-01 · M1-R01 · sai mật khẩu → alert chung, không nêu trường nào sai, form giữ giá trị", async ({
  page,
}) => {
  await page.goto("/login");
  await fillLogin(page, "acme", "an", "Sai-Passw0rd-1");
  await submit(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Sai mã công ty, tên đăng nhập hoặc mật khẩu.",
  );
  await expect(page.getByRole("textbox", { name: "Mã công ty" })).toHaveValue("acme");
  await expect(page.getByRole("textbox", { name: "Tên đăng nhập" })).toHaveValue("an");
});

test("ADM-FR-01 · UX · khi đang gửi nút hiện 'Đang đăng nhập…'", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/auth/login", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/login");
    await fillLogin(page, "acme", "an", "Sai-Passw0rd-1");
    await submit(page).click();
    await expect(page.getByRole("button", { name: "Đang đăng nhập…" })).toBeVisible();
  } finally {
    release();
  }
});

test("ADM-FR-01 · BR-05 · binh (tenant_admin) vào khung: main + 'Tổng quan' + 'Xin chào'; menu chỉ có Users, không có Tenants", async ({
  page,
}) => {
  await loginToShell(page, "acme", "binh", PW);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText(/Xin chào/)).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link", { name: "Users" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Tenants" })).toHaveCount(0);
});

test("ADM-FR-01 · BR-05 · admin (platform_admin) thấy cả link Tenants và Users; tải lại trang vẫn đăng nhập", async ({
  page,
}) => {
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link", { name: "Tenants" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Users" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
});

test("ADM-FR-03 · M1-R08 · đăng xuất qua menu tài khoản → /login và POST /auth/logout đã được gọi", async ({
  page,
}) => {
  await loginToShell(page, "acme", "binh", PW);
  const logout = page.waitForRequest(
    (r) => r.url().endsWith("/auth/logout") && r.method() === "POST",
  );
  await logoutUI(page);
  await logout;
});

test("ADM-FR-01 · UX · vào /tenants khi chưa đăng nhập → /login?next=%2Ftenants, đăng nhập xong về /tenants", async ({
  page,
}) => {
  await page.goto("/tenants");
  await expect(page).toHaveURL(/\/login\?next=%2Ftenants/);
  const a = seedAdmin();
  await fillLogin(page, "platform", a.username, a.password);
  await submit(page).click();
  await expect(page).toHaveURL(/\/tenants$/);
});

test("ADM-FR-01 · bảo mật · next=//evil.com bị bỏ qua, vẫn ở cùng origin", async ({ page }) => {
  await page.goto("/login?next=//evil.com");
  await fillLogin(page, "acme", "binh", PW);
  await submit(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan" })).toBeVisible();
  expect(new URL(page.url()).host).toBe("localhost:3000");
});

test("ADM-FR-01 · M1-R04 · tài khoản em (đã khoá) đăng nhập đúng mật khẩu → alert 'Tài khoản đã bị khoá'", async ({
  page,
}) => {
  await loginUI(page, "acme", "em", PW);
  await expect(page.getByRole("alert")).toContainText("Tài khoản đã bị khoá");
});

test("ADM-FR-06 · M1-AC06 · dung → /change-password: không có 'Bỏ qua'; 9 ký tự và nhập lại lệch bị từ chối; hợp lệ vào khung; đăng nhập lại bằng mật khẩu mới", async ({
  page,
}) => {
  await loginUI(page, "acme", "dung", TEMP_PW);
  await expect(page).toHaveURL(/\/change-password/);
  await expect(page.getByRole("heading", { name: "Đặt mật khẩu mới" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bỏ qua" })).toHaveCount(0);
  const next = page.getByLabel("Mật khẩu mới", { exact: true });
  const again = page.getByLabel("Nhập lại mật khẩu mới", { exact: true });
  const go = page.getByRole("button", { name: "Đặt mật khẩu và tiếp tục" });
  await next.fill("Ngan-1234");
  await again.fill("Ngan-1234");
  await go.click();
  await expect(page.getByText("Mật khẩu cần tối thiểu 10 ký tự")).toBeVisible();
  await next.fill("New-Passw0rd-9");
  await again.fill("New-Passw0rd-8");
  await go.click();
  await expect(page).toHaveURL(/\/change-password/);
  await again.fill("New-Passw0rd-9");
  await go.click();
  await expect(
    page.getByRole("heading", { name: "Tài khoản của bạn dùng Chat App" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login/);
  await loginUI(page, "acme", "dung", "New-Passw0rd-9");
  await expect(page).not.toHaveURL(/\/change-password/);
  await expect(
    page.getByRole("heading", { name: "Tài khoản của bạn dùng Chat App" }),
  ).toBeVisible();
});

test("ADM-FR-04 · BR-05 · member lan → /member; vào /users bị chuyển về /member", async ({
  page,
}) => {
  await loginUI(page, "acme", "lan", PW);
  await expect(
    page.getByRole("heading", { name: "Tài khoản của bạn dùng Chat App" }),
  ).toBeVisible();
  await page.goto("/users");
  await expect(page).toHaveURL(/\/member$/);
});

test("ADM-FR-06 · M1-R06 · tự đổi mật khẩu /account/password: sai mật khẩu hiện tại → lỗi ở ô; đúng → toast", async ({
  page,
}) => {
  await loginUI(page, "acme", "lan", PW);
  await expect(
    page.getByRole("heading", { name: "Tài khoản của bạn dùng Chat App" }),
  ).toBeVisible();
  await page.goto("/account/password");
  const current = page.getByLabel("Mật khẩu hiện tại", { exact: true });
  const next = page.getByLabel("Mật khẩu mới", { exact: true });
  const again = page.getByLabel("Nhập lại mật khẩu mới", { exact: true });
  const go = page.getByRole("button", { name: "Đổi mật khẩu", exact: true });
  await current.fill("Sai-Passw0rd-1");
  await next.fill("Lan-New-Passw0rd-1");
  await again.fill("Lan-New-Passw0rd-1");
  await go.click();
  await expect(current).toHaveAttribute("aria-invalid", "true");
  await current.fill(PW);
  await go.click();
  await expect(page.getByRole("status").filter({ hasText: "Đã đổi mật khẩu" })).toContainText(
    "các thiết bị khác đã được đăng xuất",
  );
});

test("ADM-FR-01 · M1-R22 · công tắc 'English' đổi nhãn sang 'Sign in'", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("ADM-FR-07 · AC-A01 · thu: 5 lần sai + lần 6 → alert 'Tạm khoá đến HH:MM' (chạy cuối file)", async ({
  page,
}) => {
  await page.goto("/login");
  for (let i = 0; i < 5; i++) {
    await fillLogin(page, "acme", "thu", "Sai-Passw0rd-1");
    const [res] = await Promise.all([loginResponse(page), submit(page).click()]);
    expect(res.status()).toBe(401);
  }
  await fillLogin(page, "acme", "thu", PW);
  const [res] = await Promise.all([loginResponse(page), submit(page).click()]);
  expect(res.status()).toBe(423);
  await expect(page.getByRole("alert")).toContainText(/Tạm khoá đến \d{2}:\d{2}/);
});
