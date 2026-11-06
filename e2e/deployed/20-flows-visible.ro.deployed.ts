// CR-120 (part F) · bất biến "tenant đã bật app thì PHẢI thấy quy trình" trên prod (ro: chỉ đọc, không ghi dữ liệu, không gọi AI).
// Sự cố gốc: tenant Demo không thấy quy trình nào vì danh sách tenant thấy đọc hub.process_tenant_defs còn việc gán nằm ở bảng cũ.
// (1) demo-owner thấy ≥ 1 quy trình ở workspace-web Cài đặt › Ứng dụng & quy trình (`apps-slot-*` có `slot-process-*`, không có
//     `slot-none-assigned`); (2) cùng người đó thấy ≥ 1 quy trình ở admin Quy trình (một trang) (mục này chỉ có
//     sau khi backfill đã lên prod; trước đó test này ĐỎ — đúng ý: đó là sự cố). (3) NiTi `tien`: bỏ qua nếu thiếu thông tin đăng nhập.
// Thông tin đăng nhập: demo-owner qua DEMO_PW (runner e2e-deployed.ps1 nạp, như các spec khác). NiTi: env NITI_TENANT / NITI_USER
// (mặc định `tien`) / NITI_PW — mật khẩu NiTi dùng một lần nên KHÔNG có trong runner; không đặt ⇒ bỏ qua. Không hardcode, không in.
// Ngân sách đăng nhập (đọc ghi chú deployed.config.ts): demo-owner 1 lần (SSO sang admin bằng menu Ứng dụng › Quản trị), NiTi 1 lần.
import type { Page } from "@playwright/test";
import { ADMIN, CW, expect, login, settle, test, watchConsole } from "./_support";

const NITI_TENANT = process.env.NITI_TENANT ?? "";
const NITI_USER = process.env.NITI_USER ?? "tien";
const NITI_PW = process.env.NITI_PW ?? "";

/** Cài đặt › Ứng dụng & quy trình: mọi khe hiện ra phải có ≥ 1 quy trình, không khe nào ở trạng thái "chưa gán". */
async function expectAppsPaneHasProcesses(page: Page): Promise<void> {
  await page.goto(`${CW}/contracts/settings?sec=apps`);
  const pane = page.getByTestId("apps-pane");
  await expect(pane).toBeVisible({ timeout: 45_000 });
  const slots = pane.locator('[data-testid^="apps-slot-"]');
  await expect(slots.first()).toBeVisible({ timeout: 45_000 }); // có ít nhất một khe
  await expect(pane.getByText(/Đang tải|Loading/)).toHaveCount(0, { timeout: 30_000 });
  await expect(pane.getByTestId("slot-none-assigned")).toHaveCount(0);
  await expect(pane.locator('[data-testid^="slot-process-"]').first()).toBeVisible();
  expect(await pane.locator('[data-testid^="slot-process-"]').count()).toBeGreaterThanOrEqual(1);
}

test.describe("20 quy trình hiển thị cho tenant (ro)", () => {
  test("demo-owner thấy ≥ 1 quy trình ở Cài đặt › Ứng dụng & quy trình và ở admin Quy trình", async ({
    page,
  }) => {
    const errs = watchConsole(page);
    await login(page, CW);
    await settle(page);
    await expectAppsPaneHasProcesses(page);

    // admin-web: SSO bằng menu Ứng dụng › Quản trị (cùng cách 04-ai-system), không đăng nhập lần hai.
    await page.goto(`${CW}/contracts`);
    await settle(page);
    await page.getByRole("button", { name: /Ứng dụng|Apps/ }).click();
    await page.getByRole("menuitem", { name: /Quản trị|Admin/ }).click();
    await page.waitForURL((u) => u.href.startsWith(ADMIN) && !u.pathname.startsWith("/login"), {
      timeout: 45_000,
    });
    await settle(page);
    await page.goto(`${ADMIN}/processes`);
    await settle(page);
    expect(new URL(page.url()).pathname.startsWith("/login")).toBe(false);

    // CR-121 c13: /processes chỉ còn là Thư viện (platform_admin); quy trình theo công ty xem ở Công ty › Quy trình (cr121-c-flows.spec.ts).
    expect(new URL(page.url()).pathname.startsWith("/processes")).toBe(true);
    expect(errs.list).toEqual([]);
  });

  test.describe("NiTi (tien)", () => {
    test.skip(
      !NITI_TENANT || !NITI_PW,
      "NITI_TENANT / NITI_PW chưa đặt (mật khẩu NiTi dùng một lần)",
    );

    test("tien thấy ≥ 1 quy trình ở Cài đặt › Ứng dụng & quy trình", async ({ page }) => {
      await page.goto(`${CW}/login`);
      const pw = page.locator("input[type=password]").first();
      await pw.waitFor({ timeout: 45_000 });
      const tenant = page.getByRole("textbox", { name: /Mã công ty|Company code/ });
      if (await tenant.count()) await tenant.fill(NITI_TENANT);
      await page.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill(NITI_USER);
      await pw.fill(NITI_PW);
      await page.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 });
      await settle(page);
      await expectAppsPaneHasProcesses(page);
    });
  });
});
