// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-127 · J01 · U2 · hành trình SOẠN → ÁP DỤNG → DUYỆT (stack journey thật, công ty `e2e-c22-<hậu tố>` CHƯA có quy trình, cờ chạy theo sự kiện đã bật):
// quản trị nền tảng ở ai-admin «Tạo quy trình» (công ty → tên → «Tạo và mở sơ đồ») → màn soạn VẼ THEO KHỐI: «+» Duyệt (Ban Giám đốc) → Nếu (Giá trị hợp đồng > 500 triệu,
// nhánh Đúng: Duyệt Kế toán) → Duyệt (Kinh doanh) → Ký số → «Áp dụng cho công ty» → mở lại đúng. Rồi Sổ Hợp Tác: nhân viên tải HĐ 600 triệu → thấy khối
// «Khi gửi, hợp đồng sẽ đi qua» → Gửi duyệt → Giám đốc nhận việc và duyệt → hồ sơ duyệt tải được PDF. Quản trị công ty chỉ xem. Dữ liệu tạo đúng đường sản phẩm (D5).
import fs from "node:fs";
import { apiLogin, companyFlows } from "../_kit/api";
import { loginTenantAdminUi } from "../_kit/ui";
import { confirmAndSave, loginAdmin, uploadAndOpen } from "../journey-approval/_journey";
import { test } from "../journey-approval/_test";
import {
  API,
  approveAs,
  envOf,
  expect,
  HUB,
  loginCw,
  newPage,
  PW,
  SPEC_TENANT,
  tenantIdOf,
  textPdf,
  U,
} from "./_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j01);
const FLOW = `Duyệt hợp đồng mua (e2e) ${E.tenantKey.slice(-6)}`;
let tenantId = "";
let flowId = "";

const platformFlows = async () => {
  const s = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  return companyFlows(HUB, s, tenantId);
};
const editorUrl = () => `${E.admin}/processes/${flowId}?company=${tenantId}`;

test.beforeAll(async () => {
  tenantId = await tenantIdOf(E);
});

test("quản trị nền tảng: Tạo quy trình từ sơ đồ trống, soạn theo khối, Áp dụng cho công ty, mở lại đúng", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await loginAdmin(page, E);
  await page.goto(`${E.admin}/processes`);
  await page.getByTestId("create-flow-open").click();
  const dlg = page.getByTestId("create-flow-dialog");
  await dlg.getByRole("combobox").first().click();
  await page.getByRole("option", { name: E.tenantName, exact: true }).click();
  await expect(dlg.getByTestId("create-flow-summary")).toBeVisible();
  await dlg.getByRole("textbox", { name: "Tên quy trình" }).fill(FLOW);
  await dlg.getByRole("button", { name: "Tạo và mở sơ đồ" }).click();
  await expect(page).toHaveURL(/\/processes\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("outline-editor")).toBeVisible();
  await expect(page.getByTestId("outline-done")).toBeVisible();

  const pick = async (approver: RegExp): Promise<void> => {
    await page
      .getByRole("combobox", { name: /Ai duyệt/ })
      .first()
      .click();
    await page.getByRole("option", { name: approver }).first().click();
  };
  // 1) Duyệt · Ban Giám đốc
  await page.getByTestId("outline-add-main-0").click();
  await page.getByTestId("flow-node-approve").click();
  await pick(/Ban Giám đốc/);
  // 2) Nếu · Giá trị hợp đồng > 500 triệu
  await page.getByTestId("outline-add-main-1").click();
  await page.getByRole("menuitem", { name: /^Nếu/ }).click();
  const cond = page.getByTestId("if-cond-1");
  await cond.getByRole("combobox").nth(0).click();
  await page.getByRole("option", { name: "Giá trị hợp đồng" }).click();
  await cond.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "lớn hơn", exact: true }).click();
  await cond.getByRole("spinbutton").fill("500000000");
  await expect(page.getByText(/Giá trị hợp đồng.*500 triệu/).first()).toBeVisible();
  // 3) nhánh Đúng: Duyệt · Phòng Kế toán
  await page.locator('[data-testid^="outline-add-"][data-testid$="-yes-0"]').click();
  await page.getByTestId("flow-node-approve").click();
  await pick(/Kế toán/);
  // 4) sau khối Nếu: Duyệt · Phòng Kinh doanh (hành động thật «Ký số» cần bước Duyệt NGAY TRƯỚC — IF_TARGET_REAL)
  await page.getByTestId("outline-add-main-2").click();
  await page.getByTestId("flow-node-approve").click();
  await pick(/Kinh doanh/);
  // 5) Ký số
  await page.getByTestId("outline-add-main-3").click();
  await page.getByRole("menuitem", { name: /Ký hợp đồng/ }).click();
  await expect(page.getByText(/Người ký phía công ty/)).toBeVisible();
  const signer = page.getByLabel(/^Phòng ban:/).first();
  if (await signer.count()) await signer.check();
  await expect(page.getByTestId("outline-chip-error")).toHaveCount(0);

  await page.getByRole("button", { name: "Áp dụng cho công ty" }).click();
  await expect
    .poll(async () => (await platformFlows()).find((f) => f.name === FLOW)?.enabled, {
      timeout: 60_000,
    })
    .toBe(true);
  flowId = (await platformFlows()).find((f) => f.name === FLOW)?.flow_id ?? "";
  expect(flowId).not.toBe("");

  // mở lại đúng: đủ bước + điều kiện Nếu + Ký số
  await page.goto(editorUrl());
  await expect(page.getByTestId("outline-editor")).toBeVisible();
  await expect(page.getByText(/Giá trị hợp đồng.*500 triệu/).first()).toBeVisible();
  await expect(page.getByText("Ký hợp đồng", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("outline-chip-error")).toHaveCount(0);
});

test("quản trị nền tảng: Chạy thử bản đang áp dụng không ghi gì, có kiểm trước khi áp dụng", async ({
  page,
}) => {
  await loginAdmin(page, E);
  await page.goto(editorUrl());
  await page.getByTestId("testrun-open").click();
  const dlg = page.getByTestId("testrun-dialog");
  await expect(dlg.getByTestId("testrun-banner")).toContainText("không tạo hợp đồng thật");
  await expect(dlg.getByTestId("testrun-path")).toBeVisible();
  await expect(dlg.getByTestId("testrun-checks")).toContainText("Kiểm tra trước khi áp dụng");
});

test("Sổ Hợp Tác: xem trước các bước → Gửi duyệt → người duyệt nhận việc và duyệt → hồ sơ duyệt tải PDF", async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const emp = await newPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, `j01-${Date.now().toString(36)}`, 600_000_000, textPdf);
  const preview = emp.getByTestId("submit-preview");
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect(preview).toContainText("Khi gửi, hợp đồng sẽ đi qua");
  await expect(preview).toContainText(/Giám đốc/);
  await confirmAndSave(emp);

  await approveAs(await newPage(browser), E, U.director, id, "Giám đốc");

  await emp.goto(`${E.cw}/contracts/c/${id}`);
  // «Hồ sơ duyệt» là khối gập (chỉ tải khi mở) ⇒ mở ra rồi mới thấy «Tải PDF»; UI lưu tệp bằng fetch → blob → thẻ a[download] ⇒ Chromium phát sự kiện download
  await emp.getByTestId("approval-record").locator("summary").click();
  await expect(emp.getByTestId("record-pdf")).toBeVisible();
  const [dl] = await Promise.all([
    emp.waitForEvent("download"),
    emp.getByTestId("record-pdf").click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/i);
  const bytes = fs.readFileSync(await dl.path());
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  expect(bytes.length).toBeGreaterThan(1_000);

  // CR-144 · hồ sơ duyệt cho XEM ngay (không tải về): thấy ai duyệt; có chữ ký/tệp ⇒ «Xem» mở hộp chi tiết, không còn nút tải tệp
  await expect(emp.getByTestId("record-line").first()).toContainText("Giám đốc");
  await expect(emp.getByRole("button", { name: "Tải tệp" })).toHaveCount(0);
  const view = emp.getByTestId("record-view").first();
  if (await view.count()) {
    await view.click();
    const box = emp.getByTestId("evidence-view");
    await expect(box).toContainText("Giám đốc");
    await expect(box.locator("img, iframe, [data-testid=evidence-other]").first()).toBeVisible();
  }
});

test("quản trị công ty chỉ xem: thấy quy trình đã áp dụng, không có nút Tạo quy trình", async ({
  page,
}) => {
  await loginTenantAdminUi(page, E.admin, E.tenantKey, U.director, PW);
  await page.goto(`${E.admin}/tenants/${tenantId}?tab=processes`);
  await expect(page.getByText(FLOW).first()).toBeVisible();
  await expect(page.getByTestId("create-flow-open")).toHaveCount(0);
});
