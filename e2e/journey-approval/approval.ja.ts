// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// e2e-journey-approval · HÀNH TRÌNH duyệt hợp đồng trên stack thật (không mock; chỉ CLI Claude giả). Bắt lỗi prod "tenant có quy trình + luật nhưng
// feature `contracts-approval-engine` tắt ⇒ HĐ xác nhận không vào duyệt, không có nút duyệt, UI im lặng".
//  1. Tenant `e2e-approval` dựng như seed-niti (chưa gán gì). Platform admin ở ai-admin gán 2 quy trình + 2 luật (Phòng KD × Mua/Bán).
//  2. CR-121 D-4: không còn công tắc "Duyệt theo quy trình" (gán là đủ). 3. Nhân viên tải HĐ + xác nhận ⇒ quy trình Mua (Kế toán → Giám đốc)
//     chạy; trưởng Kế toán thấy bước mở + nút Đạt, duyệt; Giám đốc duyệt; HĐ đã duyệt (khoá).
import { expect, type Page, test } from "@playwright/test";
import {
  adminAssignAndRoute,
  approveAs,
  confirmAndSave,
  type Env,
  loginAdmin,
  loginCw,
  openProcessBlock,
  stepOf,
  U,
  uploadAndOpen,
} from "./_journey";

// Không `serial`: ca ÂM (2) đỏ vì lỗ hổng sản phẩm không được chặn ca 3–4; workers=1 ⇒ vẫn chạy đúng thứ tự trong file.

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  tenantKey: "e2e-approval",
  tenantName: "E2E Approval Journey",
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
};
const RUN = Date.now().toString(36);
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })).newPage();

test("1 · platform admin gán 2 quy trình + 2 luật ở ai-admin", async ({ browser }) => {
  const page = await ctxPage(browser);
  await loginAdmin(page, E);
  await adminAssignAndRoute(page, E);
});

test("2 · CR-121 D-4: gán xong là đủ — khối Quy trình không còn công tắc 'Duyệt theo quy trình' hay ghi chú 'đang tắt'", async ({
  browser,
}) => {
  const page = await ctxPage(browser);
  await loginAdmin(page, E);
  const block = await openProcessBlock(page, E);
  await expect(block.getByTestId("tenant-engine-switch")).toHaveCount(0);
  await expect(block.getByTestId("tenant-engine-off-note")).toHaveCount(0);
});

test("3 · gán là đủ: nhân viên KD xác nhận ⇒ quy trình Mua chạy; trưởng Kế toán duyệt; Giám đốc duyệt; HĐ đã duyệt", async ({
  browser,
}) => {
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, `${RUN}b`);
  await confirmAndSave(emp);
  // quy trình đã chọn (Mua: Kế toán → Giám đốc) bắt đầu: bước đầu đã duyệt/mở, hai bước phòng ban hiện trên dòng thời gian
  await expect(stepOf(emp, "Phòng Kế toán duyệt")).toBeVisible({ timeout: 60_000 });
  await expect(stepOf(emp, "Ban Giám đốc duyệt")).toBeVisible();

  const acc = await ctxPage(browser);
  await approveAs(acc, E, U.accounting, id, "Phòng Kế toán duyệt");

  const dir = await ctxPage(browser);
  await approveAs(dir, E, U.director, id, "Ban Giám đốc duyệt");

  await emp.goto(`${E.cw}/contracts/c/${id}`);
  await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 30_000 });
  await expect(stepOf(emp, "Ban Giám đốc duyệt")).toHaveAttribute("data-status", "passed");
});
