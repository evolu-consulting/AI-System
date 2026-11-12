// CR-127 · J11 · U4 · nhận việc nhóm + «Cần tất cả» (stack journey thật): công ty `e2e-s3-<hậu tố>` có quy trình «Kế toán duyệt» (Cần: một người) với nhóm Kế toán =
// A (trưởng phòng Kế toán) + B (trưởng phòng Kinh doanh); công ty `e2e-s7a-<hậu tố>` cùng nhóm nhưng bước Duyệt «Cần: tất cả». HĐ do nhân viên tải + Gửi duyệt.
import { test } from "../journey-approval/_test";
import { envOf, expect, loginCw, SPEC_TENANT, submitContract } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j11);
const EALL = envOf(SPEC_TENANT.j11All);
const A = "e2e-ketoan";
const B = "e2e-kd-truong";
test.beforeAll(async ({ browser }) => {
  test.setTimeout(400_000);
  await submitContract(browser, E, `j11a-${Date.now().toString(36)}`);
  await submitContract(browser, EALL, `j11b-${Date.now().toString(36)}`);
});

test("Chưa ai nhận → A nhận → B thấy «A đang xử lý» và không duyệt được", async ({
  page,
  browser,
}) => {
  await loginCw(page, E, A);
  await page.goto("/contracts/approvals");
  await expect(
    page.getByTestId("approval-task-row").first().getByTestId("inbox-claim"),
  ).toContainText("Chưa ai nhận");
  await page.getByTestId("approval-task-row").first().click();
  await page.getByTestId("claim-take").click();
  await expect(page.getByTestId("claim-state")).toContainText("Bạn đang giữ");

  const ctx = await browser.newContext();
  const b = await ctx.newPage();
  await loginCw(b, E, B);
  await b.goto("/contracts/approvals");
  await expect(b.getByTestId("inbox-claim").first()).toContainText("đang xử lý");
  await b.getByTestId("approval-task-row").first().click();
  await expect(b.getByTestId("claim-state")).toContainText("đang xử lý");
  await expect(b.getByTestId("request-approve")).toBeDisabled();
  await ctx.close();
});

test("A trả về nhóm → «Chưa ai nhận» lại", async ({ page }) => {
  await loginCw(page, E, A);
  await page.goto("/contracts/approvals");
  await page.getByTestId("approval-task-row").first().click();
  await page.getByTestId("claim-release").click();
  await expect(page.getByTestId("claim-state")).toContainText("Chưa ai nhận");
});

test("Cần tất cả: thẻ hiện x/n, không có nút Nhận việc", async ({ page }) => {
  await loginCw(page, EALL, A);
  await page.goto("/contracts/approvals");
  await expect(
    page.getByTestId("approval-task-row").first().getByTestId("inbox-claim"),
  ).toContainText("0/2");
  await page.getByTestId("approval-task-row").first().click();
  await expect(page.getByTestId("claim-votes")).toContainText("/");
  await expect(page.getByTestId("claim-take")).toHaveCount(0);
});

test("Cần tất cả: Duyệt đòi ý kiến", async ({ page }) => {
  await loginCw(page, EALL, A);
  await page.goto("/contracts/approvals");
  await page.getByTestId("approval-task-row").first().click();
  await page.getByTestId("request-approve").click();
  await page.getByTestId("request-approve-confirm").click();
  await expect(page.getByTestId("evidence-issue")).toContainText("Ghi ý kiến");
});
