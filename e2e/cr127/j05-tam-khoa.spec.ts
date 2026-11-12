// CR-127 · J05 · U5 · tạm khoá thực hiện (stack journey thật, công ty `e2e-fsc-<hậu tố>` có quy trình «Giám đốc duyệt» (sơ đồ trống) ⇒ HĐ DONE sau khi Giám đốc duyệt, mốc Giao/Thu lập bằng API của gói): người phụ
// trách tạm khoá HĐ DONE (cần bằng chứng) ⇒ chip + băng lý do; giao/nhận mốc bị chặn, thu tiền vẫn ghi được; mở khoá cần bằng chứng.
import { test } from "../journey-approval/_test";
import { doneContractWithMilestones, envOf, expect, loginCw, SPEC_TENANT, U } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j05);
let contract = "";
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  contract = await doneContractWithMilestones(browser, E, `j05-${Date.now().toString(36)}`);
});

const proof = async (page: import("@playwright/test").Page, note: string) => {
  const dlg = page.getByTestId(/^ask-(hold|release)$/);
  await dlg.getByLabel(/Ý kiến/).fill(note);
  await dlg.locator("input[type=file]").setInputFiles({
    name: "cong-no.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 cong no"),
  });
  await expect(dlg.getByText("cong-no.pdf")).toBeVisible(); // tệp đọc xong mới bấm (đọc bất đồng bộ; bấm sớm ⇒ chưa đủ bằng chứng, hộp vẫn mở)
  await dlg.getByTestId("ask-ok").click();
};

test("Tạm khoá ⇒ chip + băng, giao bị chặn, thu tiền vẫn được", async ({ page }) => {
  await loginCw(page, E, U.employee);
  await page.goto(`/contracts/c/${contract}`);
  await page.getByTestId("act-hold").click();
  // thiếu bằng chứng ⇒ báo, chưa khoá
  await page.getByTestId("ask-ok").click();
  await expect(page.getByTestId("evidence-issue")).toBeVisible();
  await proof(page, "Đối tác nợ quá hạn 120 tr, ngừng nhận hàng tới khi trả.");
  await expect(page.getByTestId("hold-chip")).toBeVisible();
  await expect(page.getByTestId("head-banner")).toHaveAttribute("data-kind", "hold");
  await expect(page.getByTestId("head-banner")).toContainText("Đối tác nợ quá hạn");
  const delivery = page.getByTestId("ms-row").filter({ hasText: "Giao đợt 1" }).first();
  await expect(delivery.getByTestId("ms-confirm")).toHaveCount(0);
  const collect = page.getByTestId("ms-row").filter({ hasText: "Thu đợt 1" }).first();
  await expect(collect.getByTestId("ms-confirm")).toBeVisible();
});

test("Mở khoá cần bằng chứng, xong chip biến mất và giao được lại", async ({ page }) => {
  await loginCw(page, E, U.employee);
  await page.goto(`/contracts/c/${contract}`);
  await page.getByTestId("act-release").click();
  await proof(page, "Đối tác đã trả 120 tr.");
  await expect(page.getByTestId("hold-chip")).toHaveCount(0);
  await expect(page.getByTestId("act-hold")).toBeVisible();
});
