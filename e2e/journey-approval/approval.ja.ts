// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// e2e-journey-approval · HÀNH TRÌNH duyệt hợp đồng trên stack thật (không mock; chỉ CLI Claude giả). Bắt lỗi prod "tenant có quy trình + luật nhưng
// feature `contracts-approval-engine` tắt ⇒ HĐ xác nhận không vào duyệt, không có nút duyệt, UI im lặng".
//  1. Tenant `e2e-approval` dựng như seed-niti (chưa gán gì). Platform admin ở ai-admin gán 2 quy trình + 2 luật (Phòng KD × Mua/Bán).
//  2. HÀNH TRÌNH ÂM (engine tắt): nhân viên KD tải HĐ mua + "Xác nhận và lưu" ⇒ UI PHẢI nói rõ vì sao quy trình đã gán không chạy. ĐỎ = LỖI SẢN PHẨM.
//  3. Admin bật "Duyệt hợp đồng bằng quy trình". 4. Nhân viên tải HĐ mới + xác nhận ⇒ quy trình Mua (Kế toán → Giám đốc) chạy; trưởng Kế toán
//     thấy bước mở + nút Đạt, duyệt; Giám đốc duyệt; HĐ đã duyệt (khoá).
import { expect, type Page, test } from "@playwright/test";
import {
  adminAssignAndRoute,
  adminSetEngine,
  approveAs,
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

test("1b · khối Quy trình nói rõ 'đang tắt — quy trình đã gán sẽ không chạy' khi có quy trình/luật mà công tắc còn tắt", async ({
  browser,
}) => {
  const page = await ctxPage(browser);
  await loginAdmin(page, E);
  const block = await openProcessBlock(page, E);
  await expect(block.getByTestId("tenant-engine-switch")).not.toBeChecked();
  const note = block.getByTestId("tenant-engine-off-note");
  await expect(
    note,
    "công tắc tắt + có quy trình gán: khối phải nêu trạng thái và lý do",
  ).toBeVisible();
  await expect(note).toContainText(/Đang tắt/);
  await expect(note).toContainText(/không chạy/i);
});

test("2 · ÂM — engine tắt: sau 'Xác nhận và lưu' UI phải nói rõ vì sao quy trình đã gán không chạy [LỖI SẢN PHẨM nếu đỏ]", async ({
  browser,
}) => {
  const page = await ctxPage(browser);
  await loginCw(page, E, U.employee);
  const id = await uploadAndOpen(page, E, `${RUN}a`);
  await page.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.goto(`${E.cw}/contracts/c/${id}`);
  // Không có luồng engine (không có bước theo phòng ban) …
  await expect(stepOf(page, "Phòng Kế toán duyệt")).toHaveCount(0);
  // … và UI phải nêu lý do: công ty có quy trình được gán nhưng chưa bật tính năng duyệt bằng quy trình.
  const reason = page.getByText(
    /(chưa|không)\s+(được\s+)?(bật|kích hoạt|cấp)[^.\n]*(quy trình|duyệt)|(quy trình|duyệt)[^.\n]*(chưa|không)\s+(được\s+)?(bật|kích hoạt|chạy)/i,
  );
  await expect(
    reason.first(),
    "LỖI SẢN PHẨM: engine tắt mà HĐ vẫn xác nhận/duyệt kiểu cũ, UI không nói quy trình đã gán không chạy vì chưa bật tính năng",
  ).toBeVisible({ timeout: 5_000 });
});

test("3 · platform admin bật công tắc 'Duyệt theo quy trình' trong khối Quy trình; ghi chú 'đang tắt' biến mất", async ({
  browser,
}) => {
  const page = await ctxPage(browser);
  await loginAdmin(page, E);
  await adminSetEngine(page, E, true);
  const block = await openProcessBlock(page, E);
  await expect(block.getByTestId("tenant-engine-off-note")).toHaveCount(0);
});

test("4 · engine bật: nhân viên KD xác nhận ⇒ quy trình Mua chạy; trưởng Kế toán duyệt; Giám đốc duyệt; HĐ đã duyệt", async ({
  browser,
}) => {
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, `${RUN}b`);
  await emp.getByRole("button", { name: "Xác nhận và lưu" }).click();
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
