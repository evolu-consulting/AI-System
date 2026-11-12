// CR-127 · J04 · U5 · hành trình thực hiện (stack journey thật, công ty `e2e-ms-<hậu tố>` có quy trình «Giám đốc duyệt» từ sơ đồ trống ⇒ HĐ do nhân viên tải + Gửi duyệt + Giám đốc duyệt ⇒ DONE; mốc Giao 650 + Thu
// lập bằng API mốc của gói): người phụ trách xác nhận giao THIẾU kèm bằng chứng ⇒ phần còn lại giữ mở; thu trễ do đối tác ⇒ phạt ước tính ⇒ Ghi vào công nợ.
import { test } from "../journey-approval/_test";
import { doneContractWithMilestones, envOf, expect, loginCw, SPEC_TENANT, U } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j04);
/** Bấm «Xác nhận» và kiểm phản hồi của POST /obligations/:id/fulfill (thân lỗi nằm ngay trong thông báo đỏ của ca). */
async function confirmFulfill(page: import("@playwright/test").Page): Promise<void> {
  const res = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/obligations\/[^/]+\/fulfill/.test(r.url()),
  );
  await page.getByTestId("fulfill-dialog").getByTestId("fulfill-ok").click();
  const r = await res;
  expect(r.status(), `fulfill → ${r.status()}: ${(await r.text()).slice(0, 400)}`).toBeLessThan(
    300,
  );
}
let contract = "";
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  contract = await doneContractWithMilestones(browser, E, `j04-${Date.now().toString(36)}`, {
    deliveryQty: null,
    collectOwner: "partner",
  });
});

test("mốc giao: người phụ trách xác nhận giao thiếu cần bằng chứng, phần còn lại giữ mở", async ({
  page,
}) => {
  await loginCw(page, E, U.employee);
  await page.goto(`/contracts/c/${contract}`);
  await expect(page.getByTestId("status-chip")).toHaveAttribute("data-status", "done");
  const row = page.getByTestId("ms-row").filter({ hasText: "Giao đợt 1" }).first();
  // công ty KHÔNG có quy trình «Xác nhận mốc» (khởi tạo bằng sơ đồ trống) ⇒ không có việc nhóm: không có dải «Chưa ai nhận»; người phụ trách xác nhận thẳng
  await expect(row.getByTestId("claim-line")).toHaveCount(0);
  await row.getByTestId("ms-confirm").click();
  const dlg = page.getByTestId("fulfill-dialog");
  // thiếu bằng chứng ⇒ nói rõ cách khắc phục, không gọi server
  await dlg.getByTestId("fulfill-ok").click();
  await expect(dlg.getByTestId("evidence-issue")).toBeVisible();
  await dlg.getByLabel(/Ý kiến/).fill("Giao 300/650 thùng, xe hỏng giữa đường.");
  await dlg.locator("input[type=file]").setInputFiles({
    name: "bien-ban.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 bien ban"),
  });
  await expect(dlg.getByText("bien-ban.pdf")).toBeVisible(); // tệp đọc xong mới bấm (đọc bất đồng bộ)
  await confirmFulfill(page);
  await expect(dlg).toBeHidden();
  // giao thiếu ⇒ mốc con phần còn lại vẫn mở
  await expect(page.getByTestId("ms-row").filter({ hasText: "Giao" })).not.toHaveCount(0);
});

test("thu tiền trễ do đối tác ⇒ phạt ước tính ⇒ Ghi vào công nợ (một lần)", async ({ page }) => {
  await loginCw(page, E, U.employee);
  await page.goto(`/contracts/c/${contract}`);
  const row = page.getByTestId("ms-row").filter({ hasText: "Thu đợt 1" }).first();
  await row.getByTestId("ms-confirm").click();
  const dlg = page.getByTestId("fulfill-dialog");
  await dlg.locator("#fulfill-at").fill("2026-12-20");
  await expect(dlg.getByTestId("fault-ask")).toBeVisible();
  await dlg.getByLabel(/Ý kiến/).fill("Đối tác báo chậm chuyển khoản.");
  await dlg.locator("input[type=file]").setInputFiles({
    name: "sao-ke.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 sao ke"),
  });
  await expect(dlg.getByText("sao-ke.pdf")).toBeVisible();
  await confirmFulfill(page);
  await expect(page.getByTestId("penalty-box")).toBeVisible();
  await page.getByTestId("penalty-book").click();
  await expect(page.getByTestId("penalty-decided")).toContainText("Đã ghi phạt vào công nợ");
  // một mốc chỉ quyết MỘT lần: không còn nút
  await expect(page.getByTestId("penalty-book")).toHaveCount(0);
});
