// CR-127 · J13 · U6 · bên nhận KHÔNG có quy trình nhận (stack journey thật, cặp `e2e-c22u` → `e2e-c22n`; B có tính năng nhưng chưa gán flow nhận): HĐ đối tác gửi vẫn vào danh sách
// (trạng thái «Đang duyệt», băng «chờ người phụ trách quyết» ở trang chi tiết); người phụ trách thấy lý do + bước kế, không bị mắc kẹt. Tiền đề: A gửi HĐ (tải → duyệt → chọn đối tác), B nhận lời mời.
import { test } from "../journey-approval/_test";
import {
  acceptInvite,
  contractRows,
  envOf,
  expect,
  loginCw,
  SPEC_TENANT,
  sendFromA,
  U,
} from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const [KA, KB] = SPEC_TENANT.j13;
const EB = envOf(KB);
test.beforeAll(async ({ browser }) => {
  test.setTimeout(480_000);
  await sendFromA(browser, envOf(KA), KB, `j13-${Date.now().toString(36)}`);
  await acceptInvite(browser, EB);
});

test("HĐ nhận không có quy trình ⇒ trong danh sách, đang chờ người phụ trách quyết", async ({
  page,
}) => {
  await loginCw(page, EB, U.director);
  await page.goto("/contracts/list?source=partner");
  const row = contractRows(page).first();
  await expect(row.getByTestId("status-chip")).toHaveAttribute("data-status", "processing");
  // không có lượt duyệt mở ⇒ cột «Đang chờ» để «—» (spec §6); việc quyết nằm ở băng đầu trang chi tiết + «Việc của tôi»
  await expect(row.getByTestId("waiting-cell")).toHaveCount(0);
  await row.click();
  await page.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/);
  // trang chi tiết có thêm chip ở khối liên quan ⇒ chip đầu (tiêu đề HĐ)
  await expect(page.getByTestId("status-chip").first()).toHaveAttribute(
    "data-status",
    "processing",
  );
  await expect(page.getByTestId("head-banner")).toHaveAttribute("data-kind", "inbox");
});

test("Bộ lọc Nguồn: Mình tải lên ẩn HĐ đối tác gửi; Đối tác gửi chỉ còn HĐ nhận", async ({
  page,
}) => {
  await loginCw(page, EB, U.director);
  await page.goto("/contracts/list?source=upload");
  await expect(contractRows(page)).toHaveCount(0);
  await page.goto("/contracts/list?source=partner");
  await expect(contractRows(page).first()).toBeVisible();
});
