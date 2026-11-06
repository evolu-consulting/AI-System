// CR-121 c14 (R2, Q6, D5) · HÀNH TRÌNH trang công ty có ĐÚNG 5 tab cho tenant_admin và platform_admin; URL cũ chuyển đúng. admin-api + DB e2e THẬT.
// VIẾT, CHƯA CHẠY (luật 5d; điều phối chạy một lần cuối đợt).
import { expect, test } from "@playwright/test";
import { loginAdmin, loginAs, TENANT_ID } from "./support/helpers";

const TABS = ["Hồ sơ", "Ứng dụng", "Quy trình", "Thành viên", "Cài đặt"];

test("tenant_admin mở công ty mình: đúng 5 tab theo thứ tự, không còn tab Nhóm/Đối tác/Phân quyền/Agents/Quota", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.goto(`/tenants/${TENANT_ID.acme}`);
  const tabs = page.getByRole("tablist").first().getByRole("tab");
  await expect(tabs).toHaveText(TABS);
  for (const gone of ["Nhóm", "Đối tác", "Phân quyền", "Agents", "Quota"])
    await expect(page.getByRole("tab", { name: gone, exact: true })).toHaveCount(0);
  // Nhóm · Đối tác · Phân quyền · Agents là mục con của Thành viên
  await page.getByRole("tab", { name: "Thành viên" }).click();
  for (const v of ["users", "groups", "partners", "access", "agents"])
    await expect(page.getByTestId(`members-view-${v}`)).toBeVisible();
  await page.getByTestId("members-view-groups").click();
  await expect(page).toHaveURL(/view=groups/);
  // Quota nằm trong Cài đặt
  await page.getByRole("tab", { name: "Cài đặt" }).click();
  await expect(page.getByRole("heading", { name: "Quota", exact: true })).toBeVisible();
  await expect(page.getByTestId("settings-lock")).toHaveCount(0); // khoá công ty chỉ platform_admin
});

test("platform_admin: cùng 5 tab; URL cũ ?tab=groups ⇒ Thành viên › Nhóm, ?tab=quota ⇒ Cài đặt › Quota, ?tab=features ⇒ Ứng dụng", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=groups`);
  await expect(page.getByRole("tab", { name: "Thành viên", selected: true })).toBeVisible();
  await expect(page.getByTestId("members-view-groups")).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=quota`);
  await expect(page.getByRole("tab", { name: "Cài đặt", selected: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quota", exact: true })).toBeVisible();
  await page.goto(`/tenants/${TENANT_ID.acme}?tab=features`);
  await expect(page.getByRole("tab", { name: "Ứng dụng", selected: true })).toBeVisible();
  await expect(page.getByTestId("settings-lock")).toHaveCount(0);
  await page.getByRole("tab", { name: "Cài đặt" }).click();
  await expect(page.getByTestId("settings-lock")).toBeVisible(); // Khoá công ty nằm ở Cài đặt
  // dòng tóm tắt "x/y việc có quy trình" cần Hub (stack gốc không có) ⇒ kiểm ở hành trình journey-approval/cr121-c-flows.spec.ts
});
