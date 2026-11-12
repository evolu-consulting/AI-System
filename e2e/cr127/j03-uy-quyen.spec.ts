// CR-127 · J03 · U4 · hành trình uỷ quyền khi vắng (stack journey thật, công ty `e2e-s2-<hậu tố>`: quy trình «Kế toán duyệt» giao cho TRƯỞNG PHÒNG Kế toán (A, việc đích danh ⇒ áp được uỷ quyền), B = trưởng
// phòng Kế toán và B = trưởng phòng Kinh doanh): A đặt uỷ quyền cho B → việc MỚI giao cho A hiện ở «Việc của tôi» của B với nhãn «Thay…»; A thu hồi → trống.
import { test } from "../journey-approval/_test";
import { envOf, expect, loginCw, SPEC_TENANT, submitContract } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j03);
const A = "e2e-ketoan";
const B = "e2e-kd-truong";
const B_NAME = "E2E Trưởng phòng Kinh doanh";
/** Khoảng uỷ quyền phải ĐANG hiệu lực khi HĐ gửi duyệt (không cứng ngày: đồng hồ máy chạy thử khác lịch). */
const day = (plus: number): string =>
  new Date(Date.now() + plus * 86_400_000).toISOString().slice(0, 10);

test("A đặt uỷ quyền cho B từ Cài đặt › Quy trình duyệt", async ({ page }) => {
  await loginCw(page, E, A);
  await page.goto("/contracts/settings?sec=flow");
  const pane = page.getByTestId("delegation-pane");
  await expect(pane).toBeVisible();
  // thiếu người làm thay ⇒ nói rõ cách sửa, không gọi server
  await page.getByTestId("delegation-save").click();
  await expect(page.getByTestId("delegation-issue")).toContainText("Chọn người làm thay");
  await pane.getByLabel("Người làm thay").selectOption({ label: B_NAME });
  await pane.getByLabel("Từ ngày").fill(day(-1));
  await pane.getByLabel("Tới hết ngày").fill(day(3));
  await page.getByTestId("delegation-save").click();
  await expect(page.getByTestId("delegation-list")).toContainText(B_NAME);
});

test("B thấy việc của A với nhãn «Thay A» (không phải mở ở chỗ khác)", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await submitContract(browser, E, `j03-${Date.now().toString(36)}`); // việc mới giao cho A SAU khi uỷ quyền có hiệu lực
  await loginCw(page, E, B);
  await page.goto("/contracts/approvals");
  const row = page.getByTestId("approval-task-row").first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId("inbox-claim")).toContainText("Thay");
});

test("A thu hồi uỷ quyền ⇒ danh sách trống", async ({ page }) => {
  await loginCw(page, E, A);
  await page.goto("/contracts/settings?sec=flow");
  await page.getByRole("button", { name: "Thu hồi" }).first().click();
  await expect(page.getByTestId("delegation-list")).toHaveCount(0);
});
