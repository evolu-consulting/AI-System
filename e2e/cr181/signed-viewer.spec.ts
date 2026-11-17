// CR-181 · s14 · hành trình «Xem bản đã ký»: người soạn đặt chỗ ký, giám đốc ký, rồi người soạn (khác người ký) xem bản đã ký.
// Route mở thẳng `/contracts/signed/:id` (liên kết trên trang HĐ là lát s13). Chạy cuối đợt (điều phối).
import { expect, test } from "@playwright/test";
import { envOf, loginCw, newPage, SPEC_TENANT, submitContract, U } from "../cr127/_cr127-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j01);
const RUN = Date.now().toString(36);
let id = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  id = await submitContract(browser, E, RUN, undefined, undefined, true);
  const prep = await newPage(browser);
  await loginCw(prep, E, U.employee);
  await prep.goto(`${E.cw}/contracts/sign/${id}`);
  await expect(prep.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  await prep.getByRole("button", { name: /Tự đặt theo/ }).click();
  await prep.getByRole("button", { name: "Lưu chỗ ký" }).click();
  await prep.getByRole("button", { name: "Đã rõ" }).click();
  await prep.context().close();
  const sign = await newPage(browser);
  await loginCw(sign, E, U.director);
  await sign.goto(`${E.cw}/contracts/sign/${id}`);
  await sign.getByRole("button", { name: "Bấm để ký" }).first().click();
  await sign.getByRole("button", { name: "Lưu", exact: true }).click();
  await sign.getByRole("button", { name: "Lưu chữ ký" }).click();
  await expect(sign).toHaveURL(new RegExp(`/contracts/c/${id}`), { timeout: 30_000 });
  await sign.context().close();
});

test("xem bản đã ký: mặc định bản mới nhất, chọn Bản gốc không còn chữ ký, nhảy tới chữ ký, chỉ xem", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/signed/${id}`);
  await expect(page.getByTestId("signed-viewer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Xem bản đã ký" })).toBeVisible();
  await expect(page.getByTestId("viewer-version")).toContainText("Sau khi");
  await expect(page.getByTestId("viewer-mark").first()).toContainText("chữ ký nội bộ");
  await page.getByTestId("viewer-mark").first().click();
  await expect(page.getByTestId("viewer-flash").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Tải về" })).toBeVisible();
  for (const n of ["Lưu", "Xoá", "Bấm để ký"])
    await expect(page.getByRole("button", { name: n, exact: true })).toHaveCount(0);
  await page.getByTestId("viewer-version").click();
  await page.getByRole("option", { name: "Bản gốc" }).click();
  await expect(page.getByTestId("viewer-mark")).toHaveCount(0);
  await page.getByRole("button", { name: "Quay lại" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/c/${id}`));
  await page.context().close();
});

test("điện thoại 390px: ẩn khung phải, nút mở danh sách chữ ký", async ({ browser }) => {
  const page = await newPage(browser, 390);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/signed/${id}`);
  await expect(page.getByTestId("signed-viewer")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("viewer-panel")).toHaveCount(0);
  await page.getByTestId("viewer-open-list").click();
  await expect(page.getByTestId("viewer-panel")).toBeVisible();
  await page.context().close();
});
