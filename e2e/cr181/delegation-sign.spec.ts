// CR-184 · ý (5) · uỷ quyền khi vắng chạy với ký trên tài liệu: trưởng phòng (người duyệt) uỷ quyền «Duyệt» cho kế toán → HĐ gửi duyệt →
// kế toán (KHÔNG phải người tạo, KHÔNG phải người được giao gốc) mở «Mở và ký», ký bằng chữ ký CỦA MÌNH, bấm Đạt → «Xem bản đã ký» ghi «thay».
// Người bất kỳ khác (sale tạo HĐ) không có lượt ký. Viết theo khuôn contract-page-sign.spec.ts; chưa chạy (điều phối chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { envOf, loginCw, newPage, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { addMineAt, createSignatureIfAsked, HEAD, saleSends, saveSigned } from "./_cr181-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j01);
const RUN = Date.now().toString(36);
const DELEGATE = "e2e-ketoan";
const DELEGATE_NAME = "E2E Kế toán";
const HEAD_NAME = "E2E Trưởng phòng Kinh doanh";
const day = (plus: number): string =>
  new Date(Date.now() + plus * 86_400_000).toISOString().slice(0, 10);
let id = "";

test("trưởng phòng đặt uỷ quyền «Duyệt» cho kế toán (nhãn mới: Người vắng / Giao việc cho)", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await loginCw(page, E, HEAD);
  await page.goto(`${E.cw}/contracts/settings?sec=flow`);
  const pane = page.getByTestId("delegation-pane");
  await expect(pane).toContainText("Giao việc cho");
  await expect(pane).toContainText("Ký hợp đồng"); // loại «Ký số» đã đổi tên
  await pane.locator("#dg-to").fill(DELEGATE_NAME);
  await pane.getByRole("button", { name: DELEGATE_NAME, exact: true }).click();
  await pane.getByLabel("Từ ngày").fill(day(-1));
  await pane.getByLabel("Tới hết ngày").fill(day(3));
  await page.getByTestId("delegation-save").click();
  await expect(page.getByTestId("delegation-list")).toContainText(DELEGATE_NAME);
  await page.context().close();
});

test("kế toán được uỷ quyền: có lượt ký, ký bằng chữ ký của mình rồi Đạt; sale (người tạo) không có lượt", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  id = await saleSends(browser, E, RUN, U.employee); // việc mới của trưởng phòng ⇒ tự sang kế toán
  const page = await newPage(browser);
  await loginCw(page, E, DELEGATE);
  await createSignatureIfAsked(page, DELEGATE_NAME);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await page.locator("[data-approval=pass], [data-approval=approve]").first().click();
  await page.getByTestId("approver-sign").getByRole("link", { name: "Mở và ký" }).click();
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await addMineAt(page, 0, 0.5, 0.5);
  await saveSigned(page, id);
  await page.locator("[data-approval=pass], [data-approval=approve]").first().click();
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý (thay trưởng phòng)");
  await expect(page.getByTestId("request-approve-confirm")).toBeEnabled();
  await page.getByTestId("request-approve-confirm").click();
  await expect(page.getByTestId("request-evidence")).toBeHidden({ timeout: 30_000 });
  await page.context().close();
  // N2 · người tạo HĐ không có lượt ký.
  const sale = await newPage(browser);
  await loginCw(sale, E, U.employee);
  await sale.goto(`${E.cw}/contracts/c/${id}`);
  await expect(sale.getByRole("link", { name: "Mở và ký" })).toHaveCount(0);
  await sale.context().close();
});

test("hồ sơ duyệt ghi người ký thật là kế toán và «thay» trưởng phòng", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  const rec = page.getByTestId("approval-record");
  await expect(rec).toContainText(DELEGATE_NAME, { timeout: 30_000 });
  await expect(rec).toContainText(`Thay ${HEAD_NAME}`);
  await page.context().close();
});
