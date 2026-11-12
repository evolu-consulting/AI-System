// CR-127 · J07 · U6 · hai công ty gửi/nhận (stack journey thật, cặp `e2e-q6a` → `e2e-q6b`, flow gửi/nhận dựng bởi `_cr127-stack.ts`): HĐ đối tác gửi nằm TRONG danh sách Hợp đồng
// (lọc Nguồn = Đối tác gửi, cột Đang chờ), không còn mục menu «Hợp đồng đối tác gửi»; lời mời nối lần đầu hiện thành băng ở đầu danh sách; đường cũ chuyển hướng.
// Tiền đề đi đường thật: nhân viên A tải HĐ → Gửi duyệt → Giám đốc A duyệt → chọn đối tác B ⇒ lần gửi đầu bị giữ chờ B nhận lời mời.
import { safeReload } from "../_kit/ui";
import { test } from "../journey-approval/_test";
import { contractRows, envOf, expect, loginCw, SPEC_TENANT, sendFromA, U } from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const [KA, KB] = SPEC_TENANT.j07;
const EB = envOf(KB);
test.beforeAll(async ({ browser }) => {
  test.setTimeout(480_000);
  await sendFromA(browser, envOf(KA), KB, `j07-${Date.now().toString(36)}`);
});

test("Không còn mục menu «Hợp đồng đối tác gửi»; đường cũ chuyển về danh sách lọc Đối tác gửi", async ({
  page,
}) => {
  await loginCw(page, EB, U.director);
  await page.goto("/contracts");
  await expect(page.getByTestId("nav-contracts-partner-inbox")).toHaveCount(0);
  await page.goto("/contracts/partner-inbox");
  await expect(page).toHaveURL(/\/contracts\/list\?.*source=partner/);
});

test("Lời mời lần đầu ⇒ băng đầu danh sách; Nhận ⇒ băng biến mất", async ({ page }) => {
  await loginCw(page, EB, U.director);
  await page.goto("/contracts/list");
  const invite = page.getByTestId("partner-invite").first();
  await expect(invite).toBeVisible();
  await invite.getByRole("button", { name: /Nhận/ }).click();
  await expect(page.getByTestId("partner-invite")).toHaveCount(0);
});

test("HĐ đối tác gửi hiện trong danh sách với trạng thái + Đang chờ", async ({ page }) => {
  await loginCw(page, EB, U.director);
  await page.goto("/contracts/list?source=partner");
  const row = contractRows(page).first();
  await expect(row.getByTestId("status-chip")).toBeVisible();
  // lượt nhận mở NGAY SAU khi B nhận lời mời (nền tảng thả lần gửi bị giữ) ⇒ tải lại tới khi cột «Đang chờ» có người
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await safeReload(page);
    await expect(contractRows(page).first().getByTestId("waiting-cell")).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 60_000 });
});
