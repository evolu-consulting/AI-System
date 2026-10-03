// ADM-FR-41 · M4-R06 · AC-A12 · M4-AC13 · Q5 · e2e banner quota + Tổng quan (test-plan-ab-e2e E10–E13). Nhãn: ms §1, plan-frontend §6–7.
import { expect, type Page, test } from "@playwright/test";
import { insertUsage, loginAdmin, loginAs, resetFixture, withOwner } from "./support/helpers";
import { ACME, seedAcmeRuns } from "./support/m4-ab";

test.beforeEach(() => {
  resetFixture();
});

const banner = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("M4-R06 · AC-A12 · E10 · 850/1000: binh thấy alert 'Đã dùng 85% quota tháng này' + link 'Xem chi tiết' → /usage, không nút đóng, có cả ở /users; 1001 → 'Đang vượt quota, phần vượt được tính phí' + badge 'Vượt quota'", async ({
  page,
}) => {
  await seedAcmeRuns(1000, 850);
  await loginAs(page, "acme", "binh");
  const b = banner(page, "Đã dùng 85% quota tháng này");
  await expect(b).toBeVisible();
  await expect(b.getByRole("button")).toHaveCount(0);
  await b.getByRole("link", { name: "Xem chi tiết" }).click();
  await expect(page).toHaveURL(/\/usage$/);

  await page.goto("/users");
  await expect(banner(page, "Đã dùng 85% quota tháng này")).toBeVisible();

  await withOwner((sql) => insertUsage(sql, 151, { tenant: ACME, overage: 150 }));
  await page.goto("/usage");
  await expect(banner(page, "Đang vượt quota, phần vượt được tính phí")).toBeVisible();
  await expect(page.getByText("Vượt quota").first()).toBeVisible();
});

test("M4-R06 · E11 · admin cùng dữ liệu → không alert quota; binh không có quota → không alert", async ({
  page,
}) => {
  await seedAcmeRuns(1000, 850);
  await loginAdmin(page);
  await expect(region(page, "Tenant sắp hoặc đã vượt quota")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "quota" })).toHaveCount(0);
  await page.getByRole("button", { name: "Tài khoản của bạn" }).click();
  await page.getByRole("menuitem", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login/);

  await withOwner(async (sql) => {
    await sql`delete from admin.tenant_quotas where tenant_id = ${ACME}`;
  });
  await loginAs(page, "acme", "binh");
  await expect(region(page, "Quota tháng")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "quota" })).toHaveCount(0);
});

test("ADM-FR-41 · E12 · binh '/': region Users đang hoạt động, Quota tháng (progressbar Run), Người dùng mới chưa đăng nhập, Thay đổi gần đây; link 'Xem nhật ký'", async ({
  page,
}) => {
  await seedAcmeRuns(1000, 100);
  await loginAs(page, "acme", "binh");
  await expect(region(page, "Users đang hoạt động")).toBeVisible();
  await expect(region(page, "Quota tháng").getByRole("progressbar", { name: "Run" })).toBeVisible();
  await expect(region(page, "Người dùng mới chưa đăng nhập")).toBeVisible();
  await expect(region(page, "Thay đổi gần đây")).toBeVisible();
  await expect(page.getByRole("link", { name: "Xem nhật ký" })).toBeVisible();
});

test("ADM-FR-41 · Q5 · M4-AC13 · E13 · admin '/': link Tạo tenant/Tạo command; 'Tenant sắp hoặc đã vượt quota' có acme; 'Sẽ có khi Agent Hub sẵn sàng.' ×2", async ({
  page,
}) => {
  await seedAcmeRuns(1000, 850);
  await loginAdmin(page);
  await expect(page.getByRole("link", { name: "Tạo tenant" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tạo command" })).toBeVisible();
  await expect(region(page, "Tenant sắp hoặc đã vượt quota")).toContainText(/acme/i);
  await expect(page.getByText("Sẽ có khi Agent Hub sẵn sàng.")).toHaveCount(2);
});

test("M4-AC13 · E13 · admin '/' khi chưa có usage → 'Số run 24 giờ' hiện '—'", async ({ page }) => {
  await loginAdmin(page);
  await expect(region(page, "Số run 24 giờ")).toContainText("—");
});
