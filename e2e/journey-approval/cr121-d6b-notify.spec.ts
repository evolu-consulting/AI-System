// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-121 D-6b · HÀNH TRÌNH Thông báo sau bước duyệt (D5, không seed bật sẵn gì). Viết sẵn, CHẠY một lần cuối đợt (stack `playwright.journey.config.ts`).
// Công ty MỚI `e2e-d6-<hậu tố>` (chưa quy trình/luật/gán). Platform admin, chỉ bằng UI: nhân bản quy trình mẫu → thêm bước "Thông báo" sau bước
// Duyệt (người nhận = người gửi duyệt, tiêu đề có {ma_hd} {ten_hd}) → lưu nháp → xuất bản → gán cho công ty (không công tắc nào khác). Người dùng công ty
// gửi duyệt HĐ, Ban Giám đốc duyệt ⇒ người tạo HĐ thấy thông báo ở chuông, tiêu đề mang đúng mã/tên HĐ (tên HĐ có hậu tố duy nhất của lượt chạy).
import { expect, type Page, test } from "@playwright/test";
import { openTenantPage } from "../_kit/ui";
import { uniqueSuffix } from "../_kit/unique";
import { TAG } from "./_fixture";
import {
  apiAssignDef,
  approveAs,
  type Env,
  loginAdmin,
  loginCw,
  openProcessPanel,
  PROC,
  stepOf,
  U,
  uploadAndOpen,
} from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: `e2e-d6-${SFX}`,
  tenantName: `E2E D6 ${SFX}`,
};
const GD = "Ban Giám đốc duyệt";
const FLOW = `E2E D6 Thông báo ${uniqueSuffix()}`;
const RUN = `d6${Date.now().toString(36)}`;
const NOTIFY_STEP = "flow-step-1"; // bước 2 (bước 1 là Ban Giám đốc duyệt)

test.describe.configure({ mode: "serial" });

test("1 · platform admin thêm bước Thông báo sau bước Duyệt, lưu nháp rồi xuất bản", async ({
  page,
}) => {
  await loginAdmin(page, E);
  await page.goto(`${E.admin}/processes`);
  await page.getByText(PROC.sell, { exact: false }).first().click();
  // Chờ rời danh sách (mỗi dòng có nút "Nhân bản") sang trang chi tiết rồi mới bấm — tránh strict-mode khi chuyển trang chưa xong.
  await expect(page).toHaveURL(/\/processes\/[0-9a-f-]{36}/);
  await expect(page.getByRole("button", { name: "Nhân bản" })).toHaveCount(1);
  await page.getByRole("button", { name: "Nhân bản" }).click();
  await page.getByLabel("Tên quy trình mới").fill(FLOW);
  await page.getByRole("dialog").getByRole("button", { name: "Nhân bản" }).click();
  await expect(page.getByText("Đã nhân bản thành bản nháp mới")).toBeVisible();
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  await expect(page.getByTestId("flow-form")).toBeVisible();

  // nút thêm bước chỉ icon: nhãn nằm ở tooltip/aria-label
  await page.getByTestId("flow-add-notify").click();
  const step = page.getByTestId(NOTIFY_STEP);
  await expect(step).toBeVisible();
  // thiếu tiêu đề ⇒ lỗi nói cách sửa + không cho lưu
  await expect(step).toContainText("Nhập tiêu đề thông báo");
  await expect(page.getByRole("button", { name: "Lưu nháp" })).toBeDisabled();

  await step.getByLabel("Tiêu đề").fill("Đã duyệt xong hợp đồng ");
  await page.getByTestId(`${NOTIFY_STEP}-var-ma_hd`).click();
  await step.getByLabel("Tiêu đề").press("End");
  await step.getByLabel("Tiêu đề").pressSequentially(" · ");
  await page.getByTestId(`${NOTIFY_STEP}-var-ten_hd`).click();
  await expect(step.getByLabel("Tiêu đề")).toHaveValue(/\{ma_hd\}.*\{ten_hd\}/);
  await expect(page.getByTestId("flow-ready")).toBeVisible();
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(page.getByText("Đã lưu").first()).toBeVisible();

  // tải lại: bước Thông báo còn nguyên (người nhận = người gửi duyệt, tiêu đề có biến)
  await page.reload();
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  await expect(page.getByTestId(NOTIFY_STEP).getByLabel("Tiêu đề")).toHaveValue(/\{ten_hd\}/);

  await page
    .getByRole("button", { name: /^Xuất bản v\d+$/ })
    .first()
    .click();
  const pub = page.getByRole("dialog");
  await pub.getByRole("button", { name: "Xuất bản", exact: true }).click();
  await expect(page.getByText(/Đã xuất bản v\d+/).first()).toBeVisible();
});

test("2 · platform admin gán quy trình cho công ty mới (không công tắc nào khác)", async ({
  page,
}) => {
  // CR-122: ngăn Gán theo khe đã gỡ ⇒ gán đường khe cũ bằng API; tab Quy trình chỉ kiểm hiện danh sách.
  await apiAssignDef(E, FLOW);
  await loginAdmin(page, E);
  await openTenantPage(page, E.tenantName);
  await expect(await openProcessPanel(page)).toBeVisible();
});

async function openBell(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /Thông báo/ })
    .first()
    .click();
}

test("3 · người gửi duyệt thấy thông báo ở chuông sau khi Giám đốc duyệt, đúng mã/tên HĐ", async ({
  browser,
}) => {
  const ctx = async () =>
    (
      await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })
    ).newPage();
  const emp = await ctx();
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, RUN);
  // Chờ bước xác nhận của lượt duyệt ĐÃ MỞ (engine mở task bất đồng bộ sau khi AI đọc xong) rồi mới bấm: bấm sớm thì thẻ còn chưa có
  // task ⇒ client báo "Bước duyệt đã thay đổi" và không quyết (lỗi chập chờn F-5).
  await expect(async () => {
    await emp.reload();
    await expect(stepOf(emp, "Xác nhận hợp đồng")).toHaveAttribute("data-status", "open", {
      timeout: 4_000,
    });
  }).toPass({ timeout: 60_000 });
  await emp.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await expect(stepOf(emp, "Xác nhận hợp đồng")).toHaveAttribute("data-status", "passed", {
    timeout: 30_000,
  });
  await expect(stepOf(emp, GD)).toBeVisible({ timeout: 60_000 });
  // chưa duyệt ⇒ chưa có thông báo của bước Thông báo
  await approveAs(await ctx(), E, U.director, id, GD);

  // bước Thông báo chạy sau khi duyệt xong; chuông của người tạo HĐ có đúng thông báo của HĐ này
  await expect(async () => {
    await emp.goto(`${E.cw}/contracts/c/${id}`);
    await openBell(emp);
    await expect(
      emp.getByRole("dialog").getByText(`${TAG}-${RUN}`, { exact: false }).first(),
    ).toBeVisible({
      timeout: 4_000,
    });
  }).toPass({ timeout: 90_000 });
  await expect(emp.getByRole("dialog")).toContainText("Đã duyệt xong hợp đồng");
});
