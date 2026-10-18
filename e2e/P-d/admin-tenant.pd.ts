// ADM-FR-72 · AC-A14 · HUB-FR-143 · P-d1 · e2e admin-web tenant (test-plan-e2e PD-E05; nhãn nguyên văn plan-frontend §7 + i18n).
// `padmin` = platform_admin seed (tenant "platform"); `tadmin` = binh (tenant_admin acme). Múi giờ lạ = mock API 400 (page.route).
import { expect, test } from "@playwright/test";
import { TENANT_ID } from "../../tests/acceptance/M1/_data";
import { viStorageState } from "../support/locale-vi";
import { adminLogin, withSql } from "./_pd-support";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.pd.config đặt)
const ADMIN = process.env.PA_ADMIN_URL ?? "http://localhost:5305";
const TZ = (p: import("@playwright/test").Page) => p.getByRole("textbox", { name: "Múi giờ" });

async function platformLogin(p: import("@playwright/test").Page) {
  await p.goto(`${ADMIN}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  // biome-ignore lint/style/noNonNullAssertion: env bắt buộc của config
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(process.env.SEED_ADMIN_USERNAME!);
  // biome-ignore lint/style/noNonNullAssertion: env bắt buộc của config
  await p.getByLabel("Mật khẩu", { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD!);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.afterEach(() =>
  withSql(
    (sql) =>
      sql`update admin.tenants set timezone = 'Asia/Ho_Chi_Minh' where id = ${TENANT_ID.acme}`,
  ),
);

test("ADM-FR-72 · AC-A14 · PD-E05 · padmin đổi múi giờ acme sang Europe/Berlin ⇒ Lưu, tải lại giữ; tadmin không vào được /tenants", async ({
  page: p,
  browser,
}) => {
  await platformLogin(p);
  await p.goto(`/tenants/${TENANT_ID.acme}`);
  await expect(p.getByRole("tab", { name: "Thông tin" })).toBeVisible();
  await expect(TZ(p)).toHaveValue(/^Asia\/Ho_Chi_Minh/);
  await expect(TZ(p)).not.toBeEditable();
  await p.getByRole("button", { name: "Đổi múi giờ" }).click();
  await p.getByRole("searchbox", { name: "Tìm múi giờ" }).fill("Berlin");
  await p.getByRole("option", { name: "Europe/Berlin" }).click();
  const put = p.waitForResponse(
    (r) =>
      ["PATCH", "PUT"].includes(r.request().method()) && /\/tenants\/[0-9a-f-]{36}$/.test(r.url()),
  );
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await put).status()).toBe(200);
  await p.reload();
  await expect(TZ(p)).toHaveValue(/^Europe\/Berlin/);

  const ctx = await browser.newContext({ storageState: viStorageState([ADMIN]), locale: "vi-VN" });
  try {
    const t = await ctx.newPage();
    await adminLogin(t); // binh · tenant_admin acme
    await t.goto(`${ADMIN}/tenants`);
    await expect(
      t.getByRole("heading", { name: "Bạn không có quyền xem trang này" }),
    ).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("ADM-FR-72 · AC-A14 · PD-E05 · API trả 400 (múi giờ lạ) ⇒ alert 'Múi giờ này chưa được hỗ trợ…'", async ({
  page: p,
}) => {
  await platformLogin(p);
  await p.route(/\/tenants\/[0-9a-f-]{36}$/, async (route) => {
    if (!["PATCH", "PUT"].includes(route.request().method())) return route.continue();
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "VALIDATION_ERROR",
          message: "invalid",
          details: { issues: [{ path: ["timezone"], message: "unsupported" }] },
        },
      }),
    });
  });
  await p.goto(`/tenants/${TENANT_ID.acme}`);
  await p.getByRole("button", { name: "Đổi múi giờ" }).click();
  await p.getByRole("searchbox", { name: "Tìm múi giờ" }).fill("Berlin");
  await p.getByRole("option", { name: "Europe/Berlin" }).click();
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(
    p
      .getByRole("alert")
      .filter({ hasText: "Múi giờ này chưa được hỗ trợ. Chọn một múi giờ khác trong danh sách." }),
  ).toBeVisible();
});
