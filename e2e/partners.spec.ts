// ADM-FR-74, ADM-FR-75 · e2e Đối tác (CR-102a com-c1-ext-identity): tenant_admin thêm công ty đối tác, thêm tài khoản, thấy mật khẩu tạm một lần, Users có badge "Đối tác".
import { expect, type Page, test } from "@playwright/test";
import { loginToShell, PW, resetFixture, rowOf } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const COMPANY = "Cong ty Doi tac E2E";
const USERNAME = "dt.nam";

const asBinh = async (page: Page) => {
  await loginToShell(page, "acme", "binh", PW);
  await page.goto("/partners");
  await expect(page.getByRole("table", { name: "Đối tác" })).toBeVisible();
};

test("ADM-FR-74 · menu 'Đối tác' có cho tenant_admin; thêm công ty → hiện trong bảng, 0/0 tài khoản", async ({
  page,
}) => {
  await asBinh(page);
  await expect(page.getByRole("link", { name: "Đối tác" })).toBeVisible();
  await page.getByRole("button", { name: "+ Thêm công ty đối tác" }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm công ty đối tác" });
  await dialog.getByRole("textbox", { name: "Tên công ty" }).fill(COMPANY);
  await dialog.getByRole("button", { name: "Lưu" }).click();
  await expect(dialog).toBeHidden();
  const row = rowOf(page, "Đối tác", COMPANY);
  await expect(row).toBeVisible();
  await expect(row).toContainText("0/0");
  await expect(row).toContainText("Đang hoạt động");
});

test("ADM-FR-74 · tên công ty trùng → lỗi ngay ở ô, hộp thoại giữ mở", async ({ page }) => {
  await asBinh(page);
  await page.getByRole("button", { name: "+ Thêm công ty đối tác" }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm công ty đối tác" });
  const name = dialog.getByRole("textbox", { name: "Tên công ty" });
  await name.fill(COMPANY);
  await dialog.getByRole("button", { name: "Lưu" }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(dialog).toBeVisible();
});

test("ADM-FR-75 · thêm tài khoản → mật khẩu tạm 16 ký tự hiện một lần + 'Sao chép tất cả'", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await asBinh(page);
  await rowOf(page, "Đối tác", COMPANY).getByRole("button", { name: COMPANY }).click();
  const drawer = page.getByRole("dialog", { name: `Tài khoản của ${COMPANY}` });
  await drawer.getByRole("button", { name: "+ Thêm tài khoản" }).click();
  const form = page.getByRole("dialog", { name: "Thêm tài khoản" });
  await form.getByRole("textbox", { name: "Tên đăng nhập" }).fill(USERNAME);
  await form.getByRole("textbox", { name: "Tên hiển thị" }).fill("Nam Doi Tac");
  await form.getByRole("button", { name: "Tạo tài khoản" }).click();
  const done = page.getByRole("dialog", { name: `Tài khoản ${USERNAME} đã được tạo` });
  await expect(done.getByRole("textbox", { name: "Mật khẩu tạm" })).toHaveValue(
    /^[A-Za-z0-9]{16}$/,
  );
  await done.getByRole("button", { name: "Sao chép tất cả" }).click();
  await done.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(done).toBeHidden();
  const row = rowOf(page, "Tài khoản", USERNAME);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Hoạt động");
});

test("ADM-FR-75 · /users hiện badge 'Đối tác' bên cạnh tài khoản đối tác", async ({ page }) => {
  await loginToShell(page, "acme", "binh", PW);
  await page.goto("/users");
  const row = rowOf(page, "Users", USERNAME);
  await expect(row).toBeVisible();
  await expect(row.getByText("Đối tác", { exact: true })).toBeVisible();
  await expect(rowOf(page, "Users", "lan").getByText("Đối tác", { exact: true })).toHaveCount(0);
});

test("ADM-FR-74 · vô hiệu công ty (xác nhận) → trạng thái 'Đã vô hiệu', ẩn '+ Thêm tài khoản'", async ({
  page,
}) => {
  await asBinh(page);
  await rowOf(page, "Đối tác", COMPANY).getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Vô hiệu", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Không hoàn tác được.");
  await confirm.getByRole("button", { name: "Vô hiệu", exact: true }).click();
  await expect(rowOf(page, "Đối tác", COMPANY)).toContainText("Đã vô hiệu");
  await rowOf(page, "Đối tác", COMPANY).getByRole("button", { name: COMPANY }).click();
  const drawer = page.getByRole("dialog", { name: `Tài khoản của ${COMPANY}` });
  await expect(drawer.getByRole("button", { name: "+ Thêm tài khoản" })).toHaveCount(0);
  await expect(rowOf(page, "Tài khoản", USERNAME)).toContainText("Đã vô hiệu");
});
