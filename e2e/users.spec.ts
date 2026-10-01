// ADM-FR-04, ADM-FR-05, ADM-BR-08, ADM-BR-09 · e2e Users (test-plan E3).
import { expect, type Page, test } from "@playwright/test";
import {
  loginToShell,
  PW,
  resetFixture,
  rowOf,
  seedAdmin,
  USER_ID,
  withOwner,
} from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const asBinh = async (page: Page) => {
  await loginToShell(page, "acme", "binh", PW);
  await page.goto("/users");
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
};
const asAdmin = async (page: Page, tenant?: string) => {
  const a = seedAdmin();
  await loginToShell(page, "platform", a.username, a.password);
  await page.goto(tenant ? `/users?tenant=${tenant}` : "/users");
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
};
const rowMenu = async (page: Page, username: string, item: string) => {
  await rowOf(page, "Users", username).getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};
const openCreate = async (page: Page) => {
  await page.getByRole("button", { name: "+ Tạo user" }).click();
  return page.getByRole("dialog", { name: "Tạo user" });
};

test("ADM-FR-04 · BR-09 · binh: bảng chỉ có user acme, hàng 'binh (bạn)' chỉ có menu 'Sửa', không có combobox Tenant", async ({
  page,
}) => {
  await asBinh(page);
  await expect(rowOf(page, "Users", "binh (bạn)")).toBeVisible();
  await expect(rowOf(page, "Users", "lan")).toBeVisible();
  await expect(rowOf(page, "Users", "khang")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Tenant" })).toHaveCount(0);
  await rowOf(page, "Users", "binh (bạn)").getByRole("button", { name: "Thao tác khác" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: "Sửa" })).toBeVisible();
});

test("ADM-FR-04 · M1-R14 · admin: có combobox Tenant, 'Tất cả tenant' → '+ Tạo user' bị khoá; chọn acme → bật", async ({
  page,
}) => {
  await asAdmin(page);
  const picker = page.getByRole("combobox", { name: "Tenant" });
  await expect(picker).toContainText("Tất cả tenant");
  const create = page.getByRole("button", { name: "+ Tạo user" });
  await expect(create).toHaveAttribute("aria-disabled", "true");
  await picker.click();
  await page.getByRole("option", { name: /acme/i }).click();
  await expect(create).not.toHaveAttribute("aria-disabled", "true");
});

test("ADM-FR-04 · M1-R17 · tạo user: khối mật khẩu tạm 16 ký tự; đóng khi chưa sao chép → hỏi xác nhận", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await asBinh(page);
  const dialog = await openCreate(page);
  await dialog.getByRole("textbox", { name: "Tên đăng nhập" }).fill("nam");
  await dialog.getByRole("textbox", { name: "Tên hiển thị" }).fill("Nam Le");
  await dialog.getByRole("button", { name: "Tạo user", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Mật khẩu tạm" })).toHaveValue(
    /^[A-Za-z0-9]{16}$/,
  );
  await expect(dialog.getByRole("button", { name: "Sao chép tất cả" })).toBeVisible();
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Đóng mà chưa sao chép mật khẩu tạm?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Quay lại" }).click();
  await dialog.getByRole("button", { name: "Sao chép tất cả" }).click();
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rowOf(page, "Users", "nam")).toBeVisible();
});

test("ADM-FR-63 · M1-AC07 · username trùng → lỗi dưới ô; tenant_admin thiếu email → lỗi ở ô Email", async ({
  page,
}) => {
  await asBinh(page);
  const dialog = await openCreate(page);
  const username = dialog.getByRole("textbox", { name: "Tên đăng nhập" });
  await username.fill("an");
  await dialog.getByRole("textbox", { name: "Tên hiển thị" }).fill("An Khac");
  await dialog.getByRole("button", { name: "Tạo user", exact: true }).click();
  await expect(username).toHaveAttribute("aria-invalid", "true");
  await username.fill("pho");
  await dialog.getByRole("radio", { name: "tenant_admin" }).check();
  await dialog.getByRole("button", { name: "Tạo user", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("ADM-FR-05 · M1-R09 · khoá lan → alertdialog 'Khoá lan?' → badge 'Đã khoá'; mở khoá → toast", async ({
  page,
}) => {
  await asBinh(page);
  await rowMenu(page, "lan", "Khoá");
  const dialog = page.getByRole("alertdialog", { name: "Khoá lan?" });
  await dialog.getByRole("button", { name: "Khoá", exact: true }).click();
  await expect(rowOf(page, "Users", "lan").getByText("Đã khoá")).toBeVisible();
  await rowMenu(page, "lan", "Mở khoá");
  await expect(page.getByRole("status").filter({ hasText: "Đã mở khoá lan" })).toBeVisible();
  await expect(rowOf(page, "Users", "lan").getByText("Đã khoá")).toHaveCount(0);
});

test("ADM-FR-04 · M1-R17 · reset mật khẩu lan → alertdialog 'Reset mật khẩu của lan?' → mật khẩu tạm mới", async ({
  page,
}) => {
  await asBinh(page);
  await rowMenu(page, "lan", "Reset mật khẩu");
  const dialog = page.getByRole("alertdialog", { name: "Reset mật khẩu của lan?" });
  await dialog.getByRole("button", { name: "Reset mật khẩu", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Mật khẩu tạm" })).toHaveValue(
    /^[A-Za-z0-9]{16}$/,
  );
});

test("ADM-FR-05 · M1-R09 · 'Đăng xuất mọi thiết bị' lan → alertdialog 'Đăng xuất lan khỏi mọi thiết bị?' rồi đóng", async ({
  page,
}) => {
  await asBinh(page);
  await rowMenu(page, "lan", "Đăng xuất mọi thiết bị");
  const dialog = page.getByRole("alertdialog", { name: "Đăng xuất lan khỏi mọi thiết bị?" });
  await dialog.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("ADM-BR-08 · M1-AC05 · hoa (globex) mở drawer sửa chính mình: role bị khoá (disabled)", async ({
  page,
}) => {
  await loginToShell(page, "globex", "hoa", PW);
  await page.goto("/users");
  await rowMenu(page, "hoa (bạn)", "Sửa");
  const drawer = page.getByRole("dialog", { name: /hoa · Hoa Dang/ });
  await expect(drawer.getByRole("radio", { name: "tenant_admin" })).toBeDisabled();
  await expect(drawer.getByRole("radio", { name: "member" })).toBeDisabled();
});

test("ADM-BR-08 · M1-AC05 · admin khoá hoa (tenant_admin duy nhất) → 'Tenant phải còn ít nhất một tenant_admin đang hoạt động'", async ({
  page,
}) => {
  await asAdmin(page, "globex");
  await rowMenu(page, "hoa", "Khoá");
  await page
    .getByRole("alertdialog", { name: "Khoá hoa?" })
    .getByRole("button", { name: "Khoá", exact: true })
    .click();
  await expect(
    page.getByText("Tenant phải còn ít nhất một tenant_admin đang hoạt động"),
  ).toBeVisible();
});

test("ADM-BR-09 · AC-A09 · binh mở /users?drawer=edit&user=<user globex> → drawer 'Không tìm thấy'", async ({
  page,
}) => {
  await loginToShell(page, "acme", "binh", PW);
  await page.goto(`/users?drawer=edit&user=${USER_ID.globexAn}`);
  await expect(page.getByText("Không tìm thấy").first()).toBeVisible();
});

test("ADM-FR-04 · M1-R19 · phân trang: tenant bulk có 55 user → trang 1 có 50 hàng, 'Sau' sang trang 2 còn 5 hàng", async ({
  page,
}) => {
  await asAdmin(page, "bulk");
  const rows = page.getByRole("table", { name: "Users" }).getByRole("row");
  await expect(rows).toHaveCount(51); // 50 hàng + hàng tiêu đề
  await page.getByRole("button", { name: "Sau", exact: true }).click();
  await expect(rows).toHaveCount(6);
});

test("ADM-FR-01 · M1-R07 · phiên hết hạn giữa chừng: dialog 'Phiên đăng nhập đã hết hạn', đăng nhập lại giữ form và không tự gửi lại", async ({
  page,
}) => {
  await asBinh(page);
  const drawer = await openCreate(page);
  await drawer.getByRole("textbox", { name: "Tên đăng nhập" }).fill("zz1");
  await drawer.getByRole("textbox", { name: "Tên hiển thị" }).fill("Zed Mot");
  await withOwner((sql) => sql`update admin.users set active = false where id = ${USER_ID.binh}`);
  await drawer.getByRole("button", { name: "Tạo user", exact: true }).click();
  const expired = page.getByRole("dialog", { name: "Phiên đăng nhập đã hết hạn" });
  await expect(expired).toBeVisible();
  await withOwner((sql) => sql`update admin.users set active = true where id = ${USER_ID.binh}`);
  await expired.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await expired.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(expired).toBeHidden();
  await expect(drawer.getByRole("textbox", { name: "Tên đăng nhập" })).toHaveValue("zz1");
  const created = await withOwner(
    (sql) => sql`select count(*)::int as n from admin.users where username = 'zz1'`,
  );
  expect(created[0]?.n).toBe(0);
  await drawer.getByRole("button", { name: "Tạo user", exact: true }).click();
  await expect
    .poll(async () => {
      const r = await withOwner(
        (sql) => sql`select count(*)::int as n from admin.users where username = 'zz1'`,
      );
      return r[0]?.n;
    })
    .toBe(1);
});
