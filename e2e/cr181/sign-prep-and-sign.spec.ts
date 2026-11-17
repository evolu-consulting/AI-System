// CR-181 · s12 · hành trình: người soạn đặt chỗ ký (tự đặt theo «ĐẠI DIỆN BÊN A/B») rồi người ký bấm ô để ký.
// Công ty `e2e-c22-<hậu tố>` (`_cr181-stack.ts`): bật ký trên tài liệu, mọi người đã có chữ ký; HĐ PDF 6 trang. Người soạn = sale, người ký = giám đốc (khác nhau).
import { expect, test } from "@playwright/test";
import { envOf, loginCw, newPage, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { draftSample, headSignsAndPasses, saleSends } from "./_cr181-kit";

test.describe.configure({ mode: "serial" });
const E = envOf(SPEC_TENANT.j01);
const RUN = Date.now().toString(36);
let sentId = "";

test("người soạn: tự đặt chỗ ký rồi lưu, hộp kiểm tra báo đủ chỗ ký", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  const id = await draftSample(page, E, `${RUN}p`);
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
  test.setTimeout(300_000);
  sentId = await saleSends(browser, E, `${RUN}s`, U.employee);
  await headSignsAndPasses(browser, E, sentId);
  const page = await newPage(browser);
  await loginCw(page, E, U.director);
  await page.goto(`${E.cw}/contracts/sign/${sentId}`);
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Bấm để ký" }).first().click();
  await expect(page.getByRole("button", { name: /^Lưu/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Lưu/ }).first().click();
  await expect(page.getByTestId("sign-confirm")).toContainText("Sau khi lưu không sửa được");
  await page.getByRole("button", { name: "Lưu chữ ký" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/c/${sentId}`), { timeout: 30_000 });
  await page.context().close();
});
