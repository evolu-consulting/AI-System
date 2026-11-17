// CR-181 · s13 · hành trình trang hợp đồng: sale bật «Cần ký» → «Chuẩn bị chỗ ký» → Gửi duyệt; người duyệt (KHÁC người tạo)
// thấy khung «Ký trên tài liệu», «Đạt» khoá tới khi ký xong → «Mở và ký» → quay lại → Đạt. Kiểm cả điện thoại 390px.
// Tiền đề: công ty bật «Ký trên tài liệu», có quy trình duyệt bằng chứng «ý kiến + chữ ký hoặc tệp» (trưởng phòng e2e-kd-truong), HĐ PDF 6 trang chứa «ĐẠI DIỆN BÊN A/B» (`_cr181-kit.samplePdf`).
// Viết theo khuôn e2e/cr181/sign-prep-and-sign.spec.ts; chưa chạy (điều phối chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { envOf, loginCw, newPage, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { HEAD, saleSends, stepEventually } from "./_cr181-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j01);
const RUN = Date.now().toString(36);
let id = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  // Sale (người tạo) chuẩn bị chỗ ký khi HĐ còn Nháp, rồi Gửi duyệt ⇒ bước «Trưởng phòng duyệt».
  id = await saleSends(browser, E, RUN, U.employee);
});

test("sale: sau khi gửi, đầu trang có dải người ký với «n chỗ ký»", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await expect(page.getByTestId("signers-strip")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("signer-chip").first()).toContainText(/chỗ ký|Đã ký/);
  await page.context().close();
});

test("người duyệt (khác người tạo): «Đạt» khoá tới khi ký đủ, không còn ô vẽ tay", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await loginCw(page, E, HEAD);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await stepEventually(page, id, "Trưởng phòng duyệt", "open");
  const take = page.getByTestId("claim-take");
  if (await take.isVisible({ timeout: 15_000 }).catch(() => false)) await take.click();
  await page.locator("[data-approval=pass], [data-approval=approve]").first().click();
  const box = page.getByTestId("approver-sign");
  await expect(box).toBeVisible();
  await expect(page.getByTestId("signature-pad")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Ý kiến" })).toBeVisible();
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý");
  await expect(page.getByTestId("request-approve-confirm")).toBeDisabled();

  await box.getByRole("link", { name: "Mở và ký" }).click();
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Bấm để ký" }).first().click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("button", { name: "Lưu chữ ký" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/c/${id}`), { timeout: 30_000 });

  await page.locator("[data-approval=pass], [data-approval=approve]").first().click();
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý");
  await expect(page.getByTestId("approver-sign")).toContainText("đã ký");
  await expect(page.getByTestId("request-approve-confirm")).toBeEnabled();
  await page.getByTestId("request-approve-confirm").click();
  await expect(page.getByTestId("request-evidence")).toBeHidden({ timeout: 30_000 });
  await page.context().close();
});

test("tệp đã ký ⇒ «Xem bản đã ký» ở bảng Tài liệu kèm", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await expect(page.getByRole("link", { name: "Xem bản đã ký" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.context().close();
});

test("điện thoại 390px: bảng Tài liệu kèm không tràn ngang, nút ≥ 44px", async ({ browser }) => {
  const page = await newPage(browser, 390);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await expect(page.getByTestId("cfiles")).toBeVisible({ timeout: 30_000 });
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(over).toBe(false);
  const view = page.getByTestId("cfile-view").first();
  expect((await view.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId("signers-strip")).toBeVisible();
});
