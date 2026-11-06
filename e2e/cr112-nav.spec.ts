// CR-112 · ADM-FR-76 · ADM-FR-77 · sidebar lồng + công ty: platform_admin 3 nhóm + tìm; tenant_admin chỉ công ty mình; route cũ chuyển tới workspace.
import { expect, test } from "@playwright/test";
import { loginAdmin, loginAs, resetFixture, TENANT_ID } from "./support/helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetFixture();
});

const nav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Điều hướng chính" });

test("ADM-FR-77 · tenant_admin binh (CR-121 c10): sidebar phẳng Tổng quan · Công ty · Hệ thống, không nhóm NỀN TẢNG; Công ty → thẳng công ty acme; /users → tab Thành viên của acme, công ty khác ⇒ Không tìm thấy", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await expect(nav(page).getByText("NỀN TẢNG", { exact: true })).toHaveCount(0);
  await expect(nav(page).getByRole("textbox", { name: "Tìm công ty" })).toHaveCount(0);
  for (const n of ["Tổng quan", "Công ty", "Hệ thống"])
    await expect(nav(page).getByRole("link", { name: n, exact: true })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Ứng dụng", exact: true })).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Công ty", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tenants/${TENANT_ID.acme}`));
  await page.goto("/users");
  await expect(page).toHaveURL(new RegExp(`/tenants/${TENANT_ID.acme}\\?.*tab=members`));
  await expect(page.getByRole("tab", { name: "Thành viên", selected: true })).toBeVisible();
  // CR-121 c14 (Q6): tenant_admin thấy ĐỦ 5 tab; Quota rút gọn (chỉ đọc) nằm trong tab Cài đặt.
  for (const n of ["Hồ sơ", "Ứng dụng", "Quy trình", "Thành viên", "Cài đặt"])
    await expect(page.getByRole("tab", { name: n, exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Quota" })).toHaveCount(0);
  await page.goto(`/tenants/${TENANT_ID.globex}`);
  await expect(page.getByRole("heading", { name: "Không tìm thấy" })).toBeVisible();
});

test("ADM-FR-76 · platform_admin (CR-121 c10): sidebar phẳng 5-6 mục; Công ty → bảng công ty, chọn globex → workspace, /users nhớ công ty vừa chọn", async ({
  page,
}) => {
  await loginAdmin(page);
  for (const n of ["Tổng quan", "Công ty", "Ứng dụng", "Công cụ AI", "Hệ thống"])
    await expect(nav(page).getByRole("link", { name: n, exact: true })).toBeVisible();
  await expect(nav(page).getByText("NỀN TẢNG", { exact: true })).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Công ty", exact: true }).click();
  await page.getByRole("table").getByRole("link", { name: "globex", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tenants/${TENANT_ID.globex}`));
  await expect(page.getByRole("tab", { name: "Cài đặt" })).toBeVisible();
  await page.goto("/users");
  await expect(page).toHaveURL(new RegExp(`/tenants/${TENANT_ID.globex}\\?.*tab=members`));
});
test("ADM-FR-76 · AC2 · platform_admin chưa chọn công ty: /users → danh sách công ty", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.evaluate(() => localStorage.removeItem("ai.lastTenant"));
  await page.goto("/users");
  await expect(page).toHaveURL(/\/tenants$/);
});
