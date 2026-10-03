// ADM-FR-42 · M4-R07 · R08 · R09 · M4-AC03 · AC13 · e2e Chi phí & quota (test-plan-ab-e2e E5–E9). Nhãn: plan-frontend §6.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ID, insertUsage, loginAdmin, loginAs, resetFixture, withOwner } from "./support/helpers";
import { ACME, GLOBEX, KT } from "./support/m4-ab";

test.beforeEach(() => {
  resetFixture();
});

const region = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("region", { name, exact: true });

async function seedTwoTenants() {
  await withOwner(async (sql) => {
    await insertUsage(sql, 10, { tenant: ACME, feature: KT });
    await insertUsage(sql, 5, { tenant: GLOBEX });
  });
}

test("ADM-FR-42 · E5 · platform_admin: link 'Chi phí & quota' → combobox Tenant/Kỳ, 5 region KPI, biểu đồ 'Số thu theo ngày', bảng 'Theo tenant' có acme và globex", async ({
  page,
}) => {
  await seedTwoTenants();
  await loginAdmin(page);
  await page.getByRole("link", { name: "Chi phí & quota" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chi phí & quota" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tenant" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Kỳ" })).toBeVisible();
  for (const k of ["Số run", "Token", "Số thu", "Chi phí thật", "Biên"]) {
    await expect(region(page, k)).toBeVisible();
  }
  await expect(page.getByRole("img", { name: /^Số thu theo ngày/ })).toBeVisible();
  const table = page.getByRole("table", { name: "Theo tenant" });
  await expect(table.getByRole("cell", { name: /acme/ }).first()).toBeVisible();
  await expect(table.getByRole("cell", { name: /globex/ }).first()).toBeVisible();
});

test("M4-R08 · M4-AC03 · E6 · tenant_admin binh: /usage không có combobox Tenant, region 'Chi phí thật'/'Biên'; response không chứa cost_usd", async ({
  page,
}) => {
  await seedTwoTenants();
  await loginAs(page, "acme", "binh");
  const resp = page.waitForResponse(
    (r) => /\/admin\/usage(\?|$)/.test(r.url()) && r.request().method() === "GET",
  );
  await page.goto("/usage");
  const body = await (await resp).text();
  await expect(page.getByRole("heading", { level: 1, name: "Chi phí & quota" })).toBeVisible();
  await expect(region(page, "Số thu")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tenant" })).toHaveCount(0);
  await expect(region(page, "Chi phí thật")).toHaveCount(0);
  await expect(region(page, "Biên")).toHaveCount(0);
  expect(body).not.toContain("cost_usd");
  expect(body).not.toContain("margin_usd");
});

test("M4-R07 · M4-R08 · E7 · region 'Top feature theo số thu': 'Không theo feature', 'Chưa định giá', badge 'Vượt quota'", async ({
  page,
}) => {
  await withOwner(async (sql) => {
    await insertUsage(sql, 4, { tenant: ACME });
    await insertUsage(sql, 3, { tenant: ACME, feature: ID.feature.dichThuat, billable: null });
    await insertUsage(sql, 2, { tenant: ACME, feature: KT, overage: true });
  });
  await loginAs(page, "acme", "binh");
  await page.goto("/usage");
  const top = region(page, "Top feature theo số thu");
  await expect(top).toBeVisible();
  await expect(top).toContainText("Không theo feature");
  await expect(top).toContainText("Chưa định giá");
  await expect(top).toContainText("Vượt quota");
});

test("ADM-FR-42 · E8 · 'Xuất CSV' của binh → tải usage-acme-….csv, bắt đầu BOM, không cột cost_usd", async ({
  page,
}) => {
  await withOwner(async (sql) => insertUsage(sql, 3, { tenant: ACME, feature: KT }));
  await loginAs(page, "acme", "binh");
  await page.goto("/usage");
  await expect(region(page, "Số run")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^usage-acme-.+\.csv$/);
  const text = await readFile((await file.path()) as string, "utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("billable_usd");
  expect(text).not.toContain("cost_usd");
});

test("M4-R09 · M4-AC13 · E9 · usage rỗng → KPI '—', hover → tooltip 'Chưa có dữ liệu từ Agent Hub'; không ErrorState", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.goto("/usage");
  const runs = region(page, "Số run");
  await expect(runs).toContainText("—");
  await runs.getByText("—").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("Chưa có dữ liệu từ Agent Hub");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
