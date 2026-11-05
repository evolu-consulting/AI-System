// Luồng 21 · hành trình duyệt HĐ trên máy chủ thật, tenant RIÊNG `e2e-approval` (KHÔNG NiTi/Demo). Cùng các bước với stack
// `e2e/journey-approval/approval.ja.ts` (dùng chung `_journey.ts`): admin gán 2 quy trình + luật, ca ÂM engine tắt, bật engine, nhân viên KD
// tải HĐ + xác nhận, trưởng Kế toán và Giám đốc duyệt. GHI dữ liệu (gán/luật/feature của tenant e2e-, HĐ gắn thẻ E2E-JOURNEY) ⇒ project rw.
// Tiền đề (idempotent, chạy MỘT lần trên máy chủ, xem docs/specs/e2e-journey-approval/tasks.md):
//   E2E_JOURNEY_PW=… docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/seed-e2e-journey.ts --i-know-prod
// Env cho spec: E2E_JOURNEY_PW (mật khẩu 4 tài khoản e2e-), ADMIN_PW (platform admin, runner nạp). KHÔNG chạy trong lát.

import {
  adminAssignAndRoute,
  adminSetEngine,
  adminWarnings,
  approveAs,
  type Env,
  loginAdmin,
  loginCw,
  stepOf,
  U,
  uploadAndOpen,
} from "../journey-approval/_journey";
import { ADMIN, CW, expect, test } from "./_support";

// Không `serial`: ca đỏ vì lỗ hổng sản phẩm không được chặn ca sau (project rw chạy workers=1, đúng thứ tự file).

function env(): Env {
  const pw = process.env.E2E_JOURNEY_PW;
  const adminPw = process.env.ADMIN_PW;
  if (!pw || !adminPw)
    throw new Error(
      "thiếu E2E_JOURNEY_PW / ADMIN_PW — chạy qua deploy/prod-sohoptac2/e2e-deployed.ps1",
    );
  return {
    cw: CW,
    admin: ADMIN,
    tenantKey: "e2e-approval",
    tenantName: "E2E Approval Journey",
    pw,
    adminUser: "admin",
    adminPw,
  };
}
const RUN = Date.now().toString(36);

test("admin: gán 2 quy trình + luật; engine TẮT trước ca âm", async ({ browser }) => {
  const E = env();
  const page = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await loginAdmin(page, E);
  await adminAssignAndRoute(page, E);
  await adminSetEngine(page, E, false); // idempotent: lượt trước có thể đã bật
});

test("ai-admin cảnh báo đã gán quy trình nhưng chưa bật tính năng thêm (engine tắt)", async ({
  browser,
}) => {
  const E = env();
  const page = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await loginAdmin(page, E);
  expect(await adminWarnings(page, E)).toMatch(/chưa bật tính năng thêm/);
});

test("ÂM — engine tắt: UI phải nói rõ vì sao quy trình đã gán không chạy", async ({ browser }) => {
  const E = env();
  const page = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await loginCw(page, E, U.employee);
  const id = await uploadAndOpen(page, E, `${RUN}a`);
  await page.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await expect(stepOf(page, "Phòng Kế toán duyệt")).toHaveCount(0);
  await expect(
    page
      .getByText(
        /(chưa|không)\s+(được\s+)?(bật|kích hoạt|cấp)[^.\n]*(quy trình|duyệt)|(quy trình|duyệt)[^.\n]*(chưa|không)\s+(được\s+)?(bật|kích hoạt|chạy)/i,
      )
      .first(),
    "LỖI SẢN PHẨM: UI không nói quy trình đã gán không chạy vì chưa bật tính năng",
  ).toBeVisible({ timeout: 5_000 });
});

test("bật engine ⇒ Kế toán duyệt ⇒ Giám đốc duyệt ⇒ HĐ đã duyệt", async ({ browser }) => {
  const E = env();
  const admin = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await loginAdmin(admin, E);
  await adminSetEngine(admin, E, true);
  const emp = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, `${RUN}b`);
  await emp.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await expect(stepOf(emp, "Phòng Kế toán duyệt")).toBeVisible({ timeout: 60_000 });
  const acc = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await approveAs(acc, E, U.accounting, id, "Phòng Kế toán duyệt");
  const dir = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await approveAs(dir, E, U.director, id, "Ban Giám đốc duyệt");
  await emp.goto(`${E.cw}/contracts/c/${id}`);
  await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 30_000 });
  // dọn: trả engine về tắt để lượt sau lại chạy được ca âm
  await adminSetEngine(admin, E, false);
});
