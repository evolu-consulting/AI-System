// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · cr125-manual-start-ui · HÀNH TRÌNH THẬT (stack `playwright.journey.config.ts`, công ty mới `e2e-ms-<hậu tố>`): quản trị công ty dựng flow
// «Đề xuất mua hàng» bắt đầu bằng PHIẾU (ô: Tên hàng, Số lượng, Giá dự kiến, Lý do, File báo giá) + một bước Duyệt ⇒ nhân viên mở «Tạo yêu cầu»,
// điền phiếu (tải file báo giá), gửi ⇒ trang yêu cầu ⇒ người duyệt thấy thẻ có dữ liệu phiếu ⇒ Duyệt ⇒ yêu cầu hoàn tất.
// Chuẩn bị bằng API chỉ phần sản phẩm chưa làm bằng UI: flow Thư viện gốc (2 bước) — xem `cr122-flows.spec.ts`; phiếu + sửa + áp dụng đi bằng UI.
import { expect, type Page, test } from "@playwright/test";
import { apiLogin } from "../_kit/api";
import { approve, createLibraryFlow, enableFlowTriggers, finish } from "../_kit/flows";
import {
  assignFlowUi,
  flowRow,
  flowRows,
  loginPlatformAdminUi,
  loginTenantAdminUi,
  openCompanyFlows,
  openTenantPage,
} from "../_kit/ui";
import { type Env, loginCw, U } from "./_journey";

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
  tenantKey: `e2e-ms-${SFX}`,
  tenantName: `E2E MS ${SFX}`,
};
const FLOW = `Đề xuất mua hàng ${SFX}`;
const SHOTS = "docs/specs/cr125-manual-start-ui";
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })).newPage();
/** Ảnh vào docs (xem lát) và vào thư mục kết quả của lượt chạy (evotest chỉ mang về thư mục này). */
const shot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
};

let tenantId = "";
let runUrl = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  await createLibraryFlow(need("JA_HUB_URL"), platform.token, {
    key: `ms-mua-${SFX}`,
    name: FLOW,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: [
      approve("duyet", "Giám đốc duyệt", 0, "pb-giam-doc", { reject: 2 }),
      finish("xong", "Đã duyệt", 1, "approved"),
      finish("tu-choi", "Từ chối", 2, "rejected"),
    ],
  });
  tenantId = await enableFlowTriggers(E.tenantKey, false);
});

test("1 · quản trị công ty: sao chép flow, bật «Bắt đầu bằng phiếu», đặt 5 ô, Lưu và áp dụng", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const admin = await ctxPage(browser);
  await loginPlatformAdminUi(admin, E.admin, E.adminUser, E.adminPw);
  await openTenantPage(admin, E.tenantName);
  await assignFlowUi(await openCompanyFlows(admin), FLOW);

  const page = await ctxPage(browser);
  await loginTenantAdminUi(page, E.admin, E.tenantKey, U.director, E.pw);
  await page.goto(`${E.admin}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  await flowRow(box, FLOW)
    .filter({ hasText: "Được gán" })
    .getByRole("button", { name: "Sao chép để sửa" })
    .click();
  await page.getByTestId("copy-confirm").click();
  const copy = flowRows(box).filter({ hasText: `Sao từ ${FLOW} · v1` });
  await copy.getByRole("link", { name: "Mở", exact: true }).click();

  // thẻ Bắt đầu khi ⇒ bật phiếu ⇒ node «Phiếu yêu cầu» đứng ĐẦU sơ đồ
  await page.getByTestId("flow-trigger-node").click();
  await page.getByTestId("flow-start-form-toggle").getByRole("checkbox").click();
  const node = page.locator("[data-stage-uid]").filter({ hasText: "Phiếu yêu cầu" });
  await expect(node).toBeVisible();
  await expect(node).toContainText("1 ô");
  await node.click();

  const panel = page.getByTestId("stage-start-form");
  const fields: [string, string][] = [
    ["Tên hàng", "Chữ ngắn"],
    ["Số lượng", "Chữ ngắn"],
    ["Giá dự kiến", "Số tiền"],
    ["Lý do", "Chữ dài"],
    ["File báo giá", "Tệp đính kèm"],
  ];
  for (const [i, [label, type]] of fields.entries()) {
    if (i > 0) await panel.getByTestId("start-field-add").click();
    const row = panel.getByRole("group", { name: `Ô ${i + 1}`, exact: true });
    await row.getByLabel("Nhãn").fill(label);
    if (type !== "Chữ ngắn") {
      await row.getByRole("combobox", { name: "Loại" }).click();
      await page.getByRole("option", { name: type, exact: true }).click();
    }
    if (label !== "Số lượng" && label !== "Lý do" && label !== "File báo giá")
      await row.getByLabel("Bắt buộc").check();
  }
  await expect(panel.getByTestId("start-field-key").first()).toContainText("ten_hang");
  await panel.getByLabel("Tên yêu cầu").fill("Đề xuất mua {{ten_hang}}");
  await expect(node).toContainText("5 ô");
  await shot(page, "01-editor-phieu");
  await page.getByRole("button", { name: "Lưu và áp dụng" }).first().click();
  await expect(page.getByTestId("apply-status").first()).toContainText("Đã áp dụng");
  await shot(page, "02-editor-saved");
});

test("2 · nhân viên: Tạo yêu cầu → điền phiếu (tải file) → gửi → trang yêu cầu, người duyệt thấy dữ liệu phiếu → Duyệt → hoàn tất", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  await expect(emp.getByTestId("quick-new-request")).toBeVisible(); // lối tắt ở Tổng quan
  await emp.getByTestId("nav-contracts-requests").click();
  await expect(emp.getByTestId("startable-flow").filter({ hasText: FLOW })).toBeVisible({
    timeout: 60_000,
  });
  await shot(emp, "03-tao-yeu-cau-danh-sach");
  await emp.getByTestId("startable-flow").filter({ hasText: FLOW }).click();

  // bỏ trống ô bắt buộc ⇒ lỗi ngay cạnh ô
  await emp.getByTestId("request-submit").click();
  await expect(emp.getByTestId("req-field-ten_hang").getByTestId("req-field-error")).toBeVisible();
  await emp.getByLabel("Tên hàng").fill("Máy in HP LaserJet");
  await emp.getByLabel("Số lượng").fill("3");
  await emp.getByLabel("Giá dự kiến").fill("12500000");
  await emp.getByLabel("Lý do").fill("Thay máy in cũ của phòng Kinh doanh");
  await emp.getByTestId("req-file-file_bao_gia").setInputFiles({
    name: "bao-gia.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await expect(emp.getByTestId("req-file-item")).toContainText("bao-gia.pdf");
  await shot(emp, "04-phieu-da-dien");
  await emp.getByTestId("request-submit").click();

  await expect(emp.getByTestId("request-page")).toBeVisible({ timeout: 60_000 });
  runUrl = emp.url().split("?")[0] ?? "";
  await expect(emp.getByTestId("request-sent")).toBeVisible();
  await expect(emp.getByTestId("request-field-ten_hang")).toContainText("Máy in HP LaserJet");
  await expect(emp.getByTestId("request-status")).toHaveAttribute("data-status", "waiting_review", {
    timeout: 60_000,
  });
  await shot(emp, "05-yeu-cau-dang-cho-duyet");

  // người duyệt: việc chờ tôi → thẻ có dữ liệu phiếu → Duyệt
  const boss = await ctxPage(browser);
  await loginCw(boss, E, U.director);
  await boss.goto(`${E.cw}/contracts/requests`);
  const row = boss.getByTestId("requests-waiting-row").filter({ hasText: "Đề xuất mua hàng" });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(boss.getByTestId("request-field-ten_hang")).toContainText("Máy in HP LaserJet");
  await expect(boss.getByTestId("request-field-gia_du_kien")).toContainText("12.500.000");
  await shot(boss, "06-the-duyet-co-du-lieu-phieu");
  await boss.getByTestId("request-approve").click();
  await expect(boss.getByTestId("request-status")).toHaveAttribute("data-status", "done", {
    timeout: 60_000,
  });
  await shot(boss, "07-yeu-cau-hoan-tat");

  await emp.goto(runUrl);
  await expect(emp.getByTestId("request-status")).toHaveAttribute("data-status", "done", {
    timeout: 30_000,
  });
});
