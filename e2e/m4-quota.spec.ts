// ADM-FR-40 · M4-AC02 · Q9 · e2e tab Quota của tenant (test-plan-ab-e2e E1–E4, E22). Nhãn: plan-frontend §6, ms §4.3.
import { expect, type Page, test } from "@playwright/test";
import { conflictDialog, versionOf } from "./support/conflict";
import { apiAsAdmin, loginAdmin, resetFixture, withOwner } from "./support/helpers";
import { ACME, KT } from "./support/m4-ab";

test.beforeEach(() => {
  resetFixture();
});

type Resp = { url(): string; request(): { method(): string } };
const isPut = (r: Resp) =>
  /\/admin\/tenants\/[^/]+\/quotas/.test(r.url()) && r.request().method() === "PUT";
const isPatch = (r: Resp) =>
  /\/admin\/tenants\/[^/?]+$/.test(r.url()) && r.request().method() === "PATCH";

async function openQuota(page: Page) {
  await loginAdmin(page);
  await page.goto(`/tenants/${ACME}?tab=quota`);
  await expect(page.getByRole("tab", { name: "Quota" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("spinbutton", { name: "Số run · Cả tenant" })).toBeVisible();
}

test("ADM-FR-40 · E1 · đặt run cả tenant 1000 + thêm quota Kế toán USD 300 → Lưu (PUT 200) → tải lại vẫn còn", async ({
  page,
}) => {
  await openQuota(page);
  await page.getByRole("spinbutton", { name: "Số run · Cả tenant" }).fill("1000");
  await page.getByRole("button", { name: "+ Thêm quota theo feature" }).click();
  await page.getByRole("combobox", { name: "Chọn feature" }).click();
  await page.getByRole("option", { name: "Kế toán" }).click();
  await page.getByRole("spinbutton", { name: "Số USD · Kế toán" }).fill("300");
  const saved = page.waitForResponse(isPut);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Số run · Cả tenant" })).toHaveValue("1000");
  await expect(page.getByRole("spinbutton", { name: "Số USD · Kế toán" })).toHaveValue("300");
});

test("ADM-FR-40 · E2 · validate: 0 → 'Nhập số lớn hơn 0 hoặc để trống'; run 1.5 → 'Nhập số nguyên'; USD 1.234 → 'Tối đa 2 chữ số thập phân'; không gửi PUT", async ({
  page,
}) => {
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/quotas")) puts.push(r.url());
  });
  await openQuota(page);
  const run = page.getByRole("spinbutton", { name: "Số run · Cả tenant" });
  const usd = page.getByRole("spinbutton", { name: "Số USD · Cả tenant" });
  await run.fill("0");
  await run.press("Tab");
  await expect(page.getByText("Nhập số lớn hơn 0 hoặc để trống")).toBeVisible();
  await run.fill("1.5");
  await run.press("Tab");
  await expect(page.getByText("Nhập số nguyên")).toBeVisible();
  await run.fill("");
  await usd.fill("1.234");
  await usd.press("Tab");
  await expect(page.getByText("Tối đa 2 chữ số thập phân")).toBeVisible();
  expect(puts).toEqual([]);
});

test("M4-AC02 · E3 · chưa đặt quota → hàng 'Cả tenant' 'Không giới hạn', không progressbar; 'Bỏ quota Kế toán' → Lưu → hàng biến mất", async ({
  page,
}) => {
  await openQuota(page);
  const row = page.getByRole("row").filter({ hasText: "Cả tenant" });
  await expect(row).toContainText("Không giới hạn");
  await expect(row.getByRole("progressbar")).toHaveCount(0);
  await withOwner(async (sql) => {
    await sql`insert into admin.tenant_quotas (tenant_id, feature_id, max_usd)
      values (${ACME}, ${KT}, '300.00')`;
  });
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Số USD · Kế toán" })).toBeVisible();
  await page.getByRole("button", { name: "Bỏ quota Kế toán" }).click();
  const saved = page.waitForResponse(isPut);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("spinbutton", { name: "Số USD · Kế toán" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bỏ quota Kế toán" })).toHaveCount(0);
});

test("ADM-FR-40 · Q9 · E4 · sửa run trong lúc API đổi quota (version +1) → alertdialog 'Có người vừa lưu bản mới hơn'", async ({
  page,
  request,
}) => {
  await openQuota(page);
  await page.getByRole("spinbutton", { name: "Số run · Cả tenant" }).fill("500");
  const api = await apiAsAdmin(request);
  const version = await versionOf("tenants", ACME);
  const theirs = await api.put(`/admin/tenants/${ACME}/quotas`, {
    version,
    items: [{ feature_id: null, max_runs: 2000, max_tokens: null, max_usd: null }],
  });
  expect(theirs.status()).toBe(200);
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(conflictDialog(page)).toBeVisible();
});

test("ADM-FR-40 · Q9 · E22 · tab Thông tin và Quota cập nhật version cho nhau: lưu Info → Quota → Info không 409", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/tenants/${ACME}?tab=info`);
  const name = page.getByRole("textbox", { name: "Tên công ty" });
  await expect(name).toBeVisible();
  const save = page.getByRole("button", { name: "Lưu", exact: true });

  await name.fill("Acme Một");
  let resp = page.waitForResponse(isPatch);
  await save.click();
  expect((await resp).status()).toBe(200);

  await page.getByRole("tab", { name: "Quota" }).click();
  await page.getByRole("spinbutton", { name: "Số run · Cả tenant" }).fill("777");
  resp = page.waitForResponse(isPut);
  await save.click();
  expect((await resp).status()).toBe(200);
  await expect(conflictDialog(page)).toHaveCount(0);

  await page.getByRole("tab", { name: "Thông tin" }).click();
  await name.fill("Acme Hai");
  resp = page.waitForResponse(isPatch);
  await save.click();
  expect((await resp).status()).toBe(200);
  await expect(conflictDialog(page)).toHaveCount(0);
});
