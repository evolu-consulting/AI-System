// ADM-FR-42 · usage-analytics · e2e màn "Phân tích token" `/usage/analytics` (viết theo Luật 0b — chạy một lần cuối đợt):
// platform_admin lọc tenant, thấy KPI token, bảng "token đổ vào đâu" theo app, bản ghi + chi tiết run; tenant_admin không
// có bộ chọn tenant, không có chi phí (response không chứa cost_usd).
import { expect, type Page, test } from "@playwright/test";
import { loginAdmin, loginAs, resetFixture, USER_ID, withOwner } from "./support/helpers";
import { ACME, GLOBEX } from "./support/m4-ab";

const RUN = "a4900000-0000-4000-8000-0000000000e1";

test.beforeEach(async () => {
  resetFixture();
  await withOwner(async (sql) => {
    await sql`insert into hub.usage_logs (tenant_id, run_id, user_id, provider_key, model, billing, input_tokens,
        output_tokens, cost_usd, latency_ms, feature, app, outcome)
      values (${ACME}, ${RUN}, ${USER_ID.binh}, 'claude-sub', 'claude-sonnet-5-5', 'subscription', 1200, 300, 0, 900,
        'chat', 'contracts', 'ok'),
        (${ACME}, null, ${USER_ID.binh}, 'anthropic', 'claude-opus-5-5', 'api', 4000, 500, 0.03, 4000,
        'contracts.extract', null, 'ok'),
        (${GLOBEX}, null, null, 'anthropic', 'claude-haiku-5-5', 'api', 10, 5, 0.0001, 100, 'knowledge.rerank', null,
        'error')`;
  });
});

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("ADM-FR-42 · platform_admin: tab 'Phân tích token', lọc tenant acme, KPI token > 0, 'token đổ vào đâu', chi tiết run", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.getByRole("link", { name: "Chi phí & quota" }).click();
  await page.getByRole("link", { name: "Phân tích token" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Phân tích token" })).toBeVisible();
  await page.getByRole("combobox", { name: "Tenant" }).click();
  await page.getByRole("option", { name: "acme" }).click();
  await expect(page).toHaveURL(/tenant=acme/);
  await expect(region(page, "Token vào")).toContainText("5.200");
  await expect(region(page, "Chi phí ước tính")).toBeVisible();
  const flow = page.getByRole("table", { name: "Token đổ vào đâu (app → agent → model)" });
  await expect(flow).toContainText("Sổ Hợp Tác");
  await expect(flow).toContainText("contracts.extract");
  const records = page.getByRole("table", { name: "Bản ghi chi tiết" });
  await expect(records.getByRole("row")).toHaveCount(3);
  await records.getByRole("button", { name: RUN.slice(0, 8) }).click();
  await expect(page.getByRole("dialog", { name: "Chi tiết run" })).toContainText(
    "claude-sonnet-5-5",
  );
});

test("ADM-FR-42 · tenant_admin binh: không chọn tenant, không chi phí; response analytics không chứa cost_usd", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  const resp = page.waitForResponse(
    (r) => r.url().includes("/admin/usage/analytics") && r.request().method() === "GET",
  );
  await page.goto("/usage/analytics");
  const body = await (await resp).text();
  await expect(page.getByRole("heading", { level: 1, name: "Phân tích token" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tenant" })).toHaveCount(0);
  await expect(region(page, "Chi phí ước tính")).toHaveCount(0);
  await expect(region(page, "Token vào")).toContainText("5.200");
  expect(body).not.toContain("cost_usd");
  expect(body).not.toContain(GLOBEX);
});
