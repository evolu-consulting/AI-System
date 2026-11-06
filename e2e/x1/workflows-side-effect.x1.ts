// X1-AC10 (e2e) · ADM-FR-10 · HUB-FR-95 · cờ `side_effect` ở editor và danh sách Workflows (plan-frontend §2.1).
import { expect, test } from "@playwright/test";
import { ID, loginAdmin, SETUP, withOwner } from "./_support";

test.beforeEach(SETUP);

const sw = (page: import("@playwright/test").Page) =>
  page.getByRole("switch", { name: "Cần xác nhận trước khi chạy" });

test("X1-AC10 · editor translate: switch 'Cần xác nhận trước khi chạy' lưu được và tải lại vẫn bật", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/workflows/${ID.workflow.translate}`);
  await expect(page.getByRole("textbox", { name: "Key", exact: true })).toBeVisible();
  await expect(sw(page)).not.toBeChecked();
  await sw(page).click();
  await expect(sw(page)).toBeChecked();
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes(`/admin/workflows/${ID.workflow.translate}`) &&
      r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  const res = await saved;
  expect(res.status()).toBe(200);
  expect(res.request().postDataJSON()).toMatchObject({ side_effect: true });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Key", exact: true })).toBeVisible();
  await expect(sw(page)).toBeChecked();
});

test("X1-AC10 · Công cụ AI: workflow có cờ hiện huy hiệu 'Có tác dụng phụ' trong ngăn chi tiết, workflow không cờ thì không", async ({
  page,
}) => {
  await withOwner(async (sql) => {
    await sql`update admin.workflows set side_effect = true where id = ${ID.workflow.reportTax}`;
  });
  await loginAdmin(page);
  await page.goto("/ai-tools?kind=workflow"); // CR-121 R2: /workflows (danh sách) chuyển sang Công cụ AI; "Hỏi xác nhận" nay là huy hiệu "Có tác dụng phụ" trong ngăn chi tiết
  const rowOf = (key: string) =>
    page.getByRole("row", { name: new RegExp(`(?<![\\w-])${key}(?![\\w-])`) });
  await rowOf("report-tax").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("Có tác dụng phụ");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await rowOf("translate").first().click();
  await expect(drawer).toBeVisible();
  await expect(drawer).not.toContainText("Có tác dụng phụ");
});
