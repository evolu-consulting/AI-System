// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · S2 · HÀNH TRÌNH "Cài đặt nói đúng quy trình đang chạy" trên stack thật `playwright.journey.config.ts` (công ty MỚI `e2e-s2-<hậu tố>`,
// chưa gán gì): (1) chưa có quy trình Bật ⇒ Cài đặt › Quy trình duyệt nói rõ ai làm gì (không đẩy sang quản trị nền tảng); (2) platform admin gán
// flow Thư viện ở trang Quy trình (admin) ⇒ Cài đặt ở Sổ Hợp Tác hiện CÙNG tên quy trình với dòng ở tab Quy trình; không còn mục "Ứng dụng &
// quy trình" / "Quy trình HĐ mặc định"; (3) công tắc ký số trong Cài đặt bật được thật (lưu rồi tải lại vẫn bật).
import type { Page } from "@playwright/test";
import { apiLogin } from "../_kit/api";
import {
  approve,
  createLibraryFlow,
  enableFlowTriggers,
  finish,
  notifyCreator,
} from "../_kit/flows";
import {
  assignFlowUi,
  flowRow,
  loginPlatformAdminUi,
  openCompanyFlows,
  openTenantPage,
  safeReload,
} from "../_kit/ui";
import { type Env, loginCw, U } from "./_journey";
import { expect, test } from "./_test";

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
  tenantKey: `e2e-s2-${SFX}`,
  tenantName: `E2E S2 ${SFX}`,
};
const FLOW = `Duyệt 2 cấp ${SFX}`;
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })).newPage();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  await createLibraryFlow(need("JA_HUB_URL"), platform.token, {
    key: `s2-2cap-${SFX}`,
    name: FLOW,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: [
      approve("tp", "Kế toán duyệt", 0, "pb-ke-toan", { reject: 4 }),
      approve("gd", "Giám đốc duyệt", 1, "pb-giam-doc", { reject: 4 }),
      notifyCreator("bao", "Thông báo người gửi", 2, "Hợp đồng đã được duyệt"),
      finish("xong", "Đã duyệt", 3, "approved"),
      finish("tu-choi", "Từ chối", 4, "rejected"),
    ],
  });
  await enableFlowTriggers(E.tenantKey, false);
});

async function openFlowSettings(page: Page): Promise<void> {
  await page.goto(`${E.cw}/contracts/settings?sec=flow`);
  await expect(
    page.getByTestId("flow-none").or(page.getByTestId("flow-current-title")),
  ).toBeVisible({ timeout: 30_000 });
}

test("1 · chưa có quy trình Bật: Cài đặt nói rõ ai làm gì, không đẩy sang quản trị nền tảng, chỉ MỘT mục quy trình", async ({
  browser,
}, testInfo) => {
  const page = await ctxPage(browser);
  await loginCw(page, E, U.director);
  await openFlowSettings(page);
  const none = page.getByTestId("flow-none");
  await expect(none).toContainText("chưa có quy trình duyệt hợp đồng nào đang bật");
  // Phạm vi = khối quy trình duyệt. Khối "Đối tác xác nhận" (S7) cùng mục Cài đặt có hợp lệ nhãn "Quản trị nền tảng làm" cho từng điều kiện.
  await expect(none.getByText(/quản trị nền tảng/i)).toHaveCount(0);
  await expect(page.getByTestId("flow-open-page")).toBeVisible();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: /Ứng dụng & quy trình/ })).toHaveCount(0);
  await expect(dlg.getByRole("button", { name: /Quy trình duyệt/ })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("s2-after-none.png") });
});

test("2 · platform admin gán flow ⇒ Cài đặt hiện CÙNG tên với tab Quy trình, không còn 'Quy trình HĐ mặc định'", async ({
  browser,
}, testInfo) => {
  const admin = await ctxPage(browser);
  await loginPlatformAdminUi(admin, E.admin, E.adminUser, E.adminPw);
  await openTenantPage(admin, E.tenantName);
  const box = await openCompanyFlows(admin);
  const row = await assignFlowUi(box, FLOW);
  await expect(row).toContainText("Đang dùng");
  const adminName = (await flowRow(box, FLOW).first().innerText()).includes(FLOW) ? FLOW : "";
  expect(adminName).toBe(FLOW);

  const page = await ctxPage(browser);
  await loginCw(page, E, U.director);
  await openFlowSettings(page);
  await expect(page.getByTestId("flow-current-title")).toContainText(adminName);
  await expect(page.getByTestId("flow-readonly-lead")).not.toContainText("quản trị nền tảng");
  await expect(page.getByText("Quy trình HĐ mặc định")).toHaveCount(0);
  await expect(page.getByTestId("flow-default-badge")).toHaveCount(0);
  await page.getByTestId("flow-view-list").click();
  const list = page.getByTestId("flow-diagram");
  await expect(list).toContainText("Kế toán duyệt");
  await expect(list).toContainText("Giám đốc duyệt");
  await page.screenshot({ path: testInfo.outputPath("s2-after-flow.png") });
});

test("3 · công tắc ký số trong Cài đặt bật được thật (lưu, tải lại vẫn bật)", async ({
  browser,
}, testInfo) => {
  const page = await ctxPage(browser);
  await loginCw(page, E, U.director);
  await openFlowSettings(page);
  const sw = page.getByTestId("esign-enabled");
  await expect(sw).toBeVisible();
  const was = await sw.isChecked();
  await sw.click();
  await expect(page.getByText("Đã lưu cài đặt ký số.")).toBeVisible();
  await expect(sw).toBeChecked({ checked: !was });
  await safeReload(page);
  await openFlowSettings(page); // sau tải lại: mở lại hộp Cài đặt › Quy trình duyệt (trạng thái đọc từ máy chủ, không từ bộ nhớ trang)
  await expect(page.getByTestId("esign-enabled")).toBeChecked({ checked: !was });
  await page.screenshot({ path: testInfo.outputPath("s2-after-esign.png") });
});
