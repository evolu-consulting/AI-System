// CR-181 · s12 · hành trình: người soạn đặt chỗ ký (tự đặt theo «ĐẠI DIỆN BÊN A/B») rồi người ký bấm ô để ký.
// Tiền đề: công ty bật «Ký trên tài liệu», HĐ DRAFT có tệp PDF chính chứa chữ «ĐẠI DIỆN BÊN A» (xem `_cr127-kit.textPdf`), người ký công ty = Giám đốc.
// Chạy cuối đợt (điều phối). Route mở thẳng `/contracts/sign/:id` (nút mở trên trang HĐ là lát s13).
import { expect, test } from "@playwright/test";
import { envOf, loginCw, newPage, SPEC_TENANT, submitContract, U } from "../cr127/_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j01);
const RUN = Date.now().toString(36);
let id = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  id = await submitContract(browser, E, RUN, undefined, undefined, true);
});

test("người soạn: tự đặt chỗ ký rồi lưu, hộp kiểm tra báo đủ chỗ ký", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/sign/${id}`);
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Tự đặt theo/ }).click();
  await expect(page.getByRole("status")).toContainText("Đã đặt");
  await page.getByRole("button", { name: "Lưu chỗ ký" }).click();
  await expect(page.getByTestId("sign-readiness")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Đã rõ" }).click();
  await page.context().close();
});

test("người ký (khác người soạn): bấm ô «Bấm để ký», xác nhận, Lưu", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.director);
  await page.goto(`${E.cw}/contracts/sign/${id}`);
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Bấm để ký" }).first().click();
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByTestId("sign-confirm")).toContainText("Sau khi lưu không sửa được");
  await page.getByRole("button", { name: "Lưu chữ ký" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/c/${id}`), { timeout: 30_000 });
  await page.context().close();
});
