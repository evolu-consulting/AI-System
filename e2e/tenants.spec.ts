// ADM-FR-60, ADM-FR-61, ADM-BR-09 · e2e Tenants (test-plan E2).
import { expect, type Page, test } from "@playwright/test";
import {
  loginToShell,
  loginUI,
  PW,
  resetFixture,
  rowOf,
  seedAdmin,
  TENANT_ID,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const asAdmin = async (page: Page) => {
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
};
const openTenants = async (page: Page) => {
  await asAdmin(page);
  await page
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Tenants" })
    .click();
  await expect(page.getByRole("table", { name: "Tenants" })).toBeVisible();
};
const fillNewTenant = async (page: Page, key: string) => {
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(key);
  await page.getByRole("textbox", { name: "Tên công ty" }).fill(`${key} Inc`);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill("lumbergh");
  await page.getByRole("textbox", { name: "Tên hiển thị" }).fill("Bill Lumbergh");
  await page.getByRole("textbox", { name: "Email" }).fill("bill@initech.test");
};

test("ADM-FR-60 · BR-05 · admin → /tenants: table 'Tenants' có hàng platform, acme, globex", async ({
  page,
}) => {
  await openTenants(page);
  await expect(rowOf(page, "Tenants", /platform/)).toBeVisible();
  await expect(rowOf(page, "Tenants", "acme")).toBeVisible();
  await expect(rowOf(page, "Tenants", "globex")).toBeVisible();
});

test("ADM-FR-61 · M1-R10 · chip 'Đã khoá' lọc zeta; ô tìm 'glo' lọc globex", async ({ page }) => {
  await openTenants(page);
  await page.getByRole("radio", { name: /^Đã khoá/ }).click();
  await expect(rowOf(page, "Tenants", "zeta")).toBeVisible();
  await expect(rowOf(page, "Tenants", "acme")).toHaveCount(0);
  await page.getByRole("radio", { name: /^Tất cả/ }).click();
  await page.getByRole("searchbox").fill("glo");
  await expect(rowOf(page, "Tenants", "globex")).toBeVisible();
  await expect(rowOf(page, "Tenants", "acme")).toHaveCount(0);
});

test("ADM-BR-05 · BR-09 · tenant_admin vào /tenants → 'Bạn không có quyền xem trang này' + link 'Về Tổng quan'", async ({
  page,
}) => {
  await loginToShell(page, "acme", "binh", PW);
  await page.goto("/tenants");
  await expect(
    page.getByRole("heading", { name: "Bạn không có quyền xem trang này" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Về Tổng quan" })).toBeVisible();
});

test("ADM-FR-60 · M1-R17 · tạo tenant → dialog 'Đã tạo tenant initech': mật khẩu tạm 16 ký tự, Esc/click nền không đóng, 'Đi tới tenant' khoá tới khi tick", async ({
  page,
}) => {
  await openTenants(page);
  await page.getByRole("link", { name: "+ Tạo tenant" }).click();
  await fillNewTenant(page, "initech");
  await page.getByRole("button", { name: "Tạo tenant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Đã tạo tenant initech" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Mật khẩu tạm" })).toHaveValue(
    /^[A-Za-z0-9]{16}$/,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  const go = dialog.getByRole("button", { name: "Đi tới tenant" });
  await expect(go).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Tôi đã lưu mật khẩu tạm" }).check();
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page).toHaveURL(/\/tenants\/[0-9a-f-]{36}$/);
});

test("ADM-FR-60 · M1-R15 · tạo tenant với mã trùng 'acme' → 'Mã công ty đã được dùng'", async ({
  page,
}) => {
  await openTenants(page);
  await page.getByRole("link", { name: "+ Tạo tenant" }).click();
  await fillNewTenant(page, "acme");
  await page.getByRole("button", { name: "Tạo tenant", exact: true }).click();
  await expect(page.getByText("Mã công ty đã được dùng")).toBeVisible();
});

test("ADM-FR-60 · M1-R19 · chi tiết acme: mã readonly, sửa tên + Lưu → toast 'Đã lưu acme'; tab Feature/Agent/Quota 'Chưa khả dụng'", async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  await expect(page.getByRole("tab", { name: "Thông tin" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mã công ty" })).not.toBeEditable();
  await page.getByRole("textbox", { name: "Tên công ty" }).fill("Acme Corp 2");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu acme" })).toBeVisible();
  for (const tab of ["Feature", "Agent", "Quota"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByText("Chưa khả dụng").first()).toBeVisible();
  }
});

test("ADM-FR-61 · M1-AC03 · khoá acme: gõ 'acme' mới bật nút; user acme không đăng nhập được; mở khoá → toast", async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  await page.getByRole("button", { name: "Khoá tenant", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Khoá tenant acme?" });
  const confirm = dialog.getByRole("button", { name: "Khoá tenant", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Gõ acme để xác nhận" }).fill("acme");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole("status").filter({ hasText: "Đã khoá acme" })).toBeVisible();
  const login = await page.request.post("/auth/login", {
    data: { tenant_key: "acme", username: "an", password: PW },
  });
  expect(login.status()).toBe(403);
  await page.getByRole("button", { name: "Mở khoá tenant", exact: true }).click();
  const unlock = page.getByRole("alertdialog", { name: "Mở khoá acme?" });
  await unlock.getByRole("button", { name: "Mở khoá", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã mở khoá acme" })).toBeVisible();
});

test("ADM-FR-61 · M1-R10 · tenant platform không có nút khoá", async ({ page }) => {
  await asAdmin(page);
  const id = await withOwner(async (sql) => {
    const [r] = await sql<{ id: string }[]>`select id from admin.tenants where key = 'platform'`;
    return r?.id;
  });
  await page.goto(`/tenants/${id}`);
  await expect(page.getByRole("tab", { name: "Thông tin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Khoá tenant" })).toHaveCount(0);
});

test("ADM-BR-09 · id lạ → heading 'Không tìm thấy'", async ({ page }) => {
  await asAdmin(page);
  await page.goto("/tenants/01900000-0000-7000-8000-000000000999");
  await expect(page.getByRole("heading", { name: "Không tìm thấy" })).toBeVisible();
});

test("ADM-FR-61 · M1-R10 · đăng nhập UI vào tenant bị khoá (zeta) → alert 'Tài khoản đã bị khoá'", async ({
  page,
}) => {
  await loginUI(page, "zeta", "zed", PW);
  await expect(page.getByRole("alert")).toContainText("Tài khoản đã bị khoá");
});
