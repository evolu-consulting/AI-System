// CR-121 · cr121-c2-tenant-profile · hành trình thật: platform_admin mở công ty ⇒ tab Hồ sơ (không còn tab Tổng quan, có dòng tóm tắt),
// sửa tên công ty tại chỗ, chọn CEO từ thành viên, nhập số nhân viên sai ⇒ lỗi dễ hiểu; tenant_admin chỉ xem.
// Dữ liệu: công ty `acme` của fixture e2e (resetFixture trước/sau); không thêm dữ liệu dùng chung.
import { expect, test } from "@playwright/test";
import { loginAdmin, loginAs, resetFixture, TENANT_ID, toast } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => resetFixture());
test.afterAll(() => resetFixture());

test("CR-121 · tab Hồ sơ là mặc định, không còn tab Tổng quan; dòng tóm tắt ở đầu trang", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  await expect(page.getByRole("tab", { name: "Hồ sơ", selected: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tổng quan" })).toHaveCount(0);
  await expect(page.getByTestId("tenant-summary")).toHaveCount(0); // F11: không còn dòng tóm tắt đầu trang
  for (const name of ["Thông tin công ty", "Liên hệ và lãnh đạo", "Phòng ban"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
});

test("CR-121 · sửa tên công ty tại chỗ (Lưu), rồi chọn CEO từ thành viên", async ({ page }) => {
  await loginAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=profile`);

  // Tên công ty: bấm bút ⇒ ô nhập ⇒ Lưu ⇒ tiêu đề trang đổi.
  await page.getByRole("button", { name: "Sửa Tên công ty" }).click();
  await page.getByRole("textbox", { name: "Tên công ty" }).fill("Acme Việt Nam");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(toast(page, "Đã lưu acme")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Acme Việt Nam" })).toBeVisible();

  // Số nhân viên sai ⇒ lỗi dễ hiểu, chưa lưu; nhập đúng ⇒ lưu được.
  await page.getByRole("button", { name: "Sửa Số nhân viên" }).click();
  await page.getByRole("textbox", { name: "Số nhân viên" }).fill("-3");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("số nguyên từ 0 trở lên");
  await page.getByRole("textbox", { name: "Số nhân viên" }).fill("42");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByText("42 nhân viên")).toBeVisible();

  // CEO: chọn một thành viên của công ty (Binh Le là tenant_admin của acme trong fixture).
  await page.getByRole("button", { name: "Sửa CEO" }).click();
  await page.getByRole("combobox", { name: "CEO" }).selectOption({ label: "Binh Le" });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByTestId("field-tp-ceo")).toContainText("Binh Le");

  // Tải lại: dữ liệu còn đó (đã ghi DB, không chỉ trên màn hình).
  await page.reload();
  await expect(page.getByTestId("field-tp-ceo")).toContainText("Binh Le");
  await expect(page.getByText("42 nhân viên")).toBeVisible();
});

test("CR-121 · tenant_admin chỉ xem hồ sơ công ty mình (không có nút Sửa)", async ({ page }) => {
  await loginAs(page, "acme", "binh");
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=profile`);
  await expect(page.getByTestId("tenant-profile-tab")).toBeVisible();
  await expect(page.getByTestId("field-tp-ceo")).toContainText("Binh Le");
  await expect(page.getByRole("button", { name: /^Sửa / })).toHaveCount(0);
});
