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
const DELEGATE_NAME = "E2E Trưởng phòng Kế toán";
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
  // Form MỘT câu: «<Người vắng ▾> vắng từ … đến hết … giao việc [Duyệt] [Ký hợp đồng] … cho [Chọn người ▾] [Lưu uỷ quyền]»; mặc định bật «Duyệt».
  await expect(pane).toContainText("vắng từ");
  await expect(pane).toContainText("giao việc");
  await expect(page.getByTestId("delegation-kind-approve")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("delegation-kind-form")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("delegation-kind-esign")).toContainText("Ký hợp đồng"); // loại «Ký số» đã đổi tên
  await page.getByTestId("delegation-to").click();
  await page.getByRole("searchbox").fill(DELEGATE_NAME);
  await page.getByRole("button", { name: DELEGATE_NAME }).first().click();
  await pane.getByLabel("Từ ngày").fill(day(-1));
  await pane.getByLabel("Tới hết ngày").fill(day(3));
  await page.getByTestId("delegation-save").click();
  await expect(page.getByTestId("delegation-list")).toContainText(DELEGATE_NAME);
  await expect(page.getByTestId("delegation-list")).toContainText("Duyệt");
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
  await expect(page.getByTestId("sign-behalf")).toContainText(`Bạn đang ký thay ${HEAD_NAME}`);
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
  await rec.locator("summary").click(); // hồ sơ duyệt là khối gập
  const line = rec.getByTestId("record-line").first();
  await expect(line).toContainText(DELEGATE_NAME, { timeout: 30_000 });
  await expect(line).toContainText(`(thay ${HEAD_NAME})`);
  await page.context().close();
});

test("Lịch sử uỷ quyền (thu gọn): trạng thái, người đặt, số việc đã làm thay → danh sách việc mở được hợp đồng", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await loginCw(page, E, HEAD);
  await page.goto(`${E.cw}/contracts/settings?sec=flow`);
  await expect(page.getByTestId("delegation-history-row")).toHaveCount(0); // thu gọn: chưa nạp
  await page.getByTestId("delegation-history-toggle").click();
  const row = page.getByTestId("delegation-history-row").first();
  await expect(row).toContainText(HEAD_NAME);
  await expect(row).toContainText(DELEGATE_NAME);
  await expect(row.getByTestId("delegation-status")).toHaveText("Còn hiệu lực");
  await expect(row.getByTestId("delegation-done")).toContainText("1 việc đã làm thay");
  await row.getByTestId("delegation-done").click();
  await page.getByTestId("delegation-work").getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/contracts/c/${id}`));
  await page.context().close();
});

test("kế toán thấy uỷ quyền có mình trong lịch sử; màn ký nói «Bạn đang ký thay …» (điện thoại 390px: nút ≥ 44px)", async ({
  browser,
}) => {
  const page = await newPage(browser, 390);
  await loginCw(page, E, DELEGATE);
  await page.goto(`${E.cw}/contracts/settings?sec=flow`);
  await page.getByTestId("delegation-history-toggle").click();
  await expect(page.getByTestId("delegation-history-row").first()).toContainText(HEAD_NAME);
  const h = await page
    .getByTestId("delegation-history-toggle")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
  await page.context().close();
});
