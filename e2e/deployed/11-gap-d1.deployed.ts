// Luồng 11 · gap-d1 trên máy chủ (CÓ GHI — một SP gắn TAG): Sản phẩm & Giá → "Thêm sản phẩm" (tên TAG, hàng hoá, quy cách) → tab "Kho & lô"
// → "Nhập lô" (SL 5, giá 100.000) ⇒ tồn 5 → tab "Cách lấy hàng" → thêm NCC ⇒ có bảng rủi ro → tab "Nhận diện" → thêm quy tắc →
// tab "Nhà cung cấp & giá" → "Nhập giá tay" ⇒ dòng giá. Cần: contracts 0043. Chạy: e2e-deployed.ps1 -Spec e2e/deployed/11-gap-d1.deployed.ts
import type { Page } from "@playwright/test";
import { CW, expect, login, settle, TAG, test } from "./_support";

let page: Page;
// Sản phẩm không xoá được qua app và tên/quy tắc phải duy nhất ⇒ mỗi lần chạy một hậu tố riêng (chạy lại không đụng dữ liệu cũ).
const RUN = Date.now().toString(36);
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
  page = await ctx.newPage();
  await login(page, CW);
  await settle(page);
});
test.afterAll(async () => {
  await page.context().close();
});

test.describe("11 gap-d1", () => {
  test("thêm SP tay → nhập lô → cách lấy hàng → nhận diện → nhập giá tay", async () => {
    test.setTimeout(180_000);
    await page.goto(`${CW}/products`);
    await settle(page);
    await page.getByTestId("gd1-add-product").click();
    await page.getByTestId("gd1-p-name").fill(`${TAG} Cáp mạng ${RUN}`);
    await page.getByTestId("gd1-p-unit").fill("cuộn");
    await page.getByTestId("gd1-p-spec").fill("305m");
    await page.getByTestId("gd1-p-save").click();

    await page.getByRole("tab", { name: "Kho & lô" }).click();
    await page.getByTestId("gd1-l-open").click();
    await page.getByTestId("gd1-l-qty").fill("5");
    await page.getByTestId("gd1-l-price").fill("100000");
    await page.getByTestId("gd1-l-save").click();
    await expect(page.getByRole("cell", { name: /^5/ }).first()).toBeVisible();

    await page.getByRole("tab", { name: "Cách lấy hàng" }).click();
    await page.getByTestId("gd1-s-open").click();
    await page.getByTestId("gd1-s-sup").fill(`${TAG} NCC`);
    await page.getByTestId("gd1-s-lead").fill("5");
    await page.getByTestId("gd1-s-save").click();
    await expect(page.getByTestId("gd1-risk")).toBeVisible();

    await page.getByRole("tab", { name: "Nhận diện" }).click();
    await page.getByTestId("gd1-r-pattern").fill(`${TAG} cap mang ${RUN}`);
    await page.getByTestId("gd1-r-add").click();
    await expect(page.getByText(`${TAG} cap mang ${RUN}`)).toBeVisible();

    await page.getByRole("tab", { name: /Nhà cung cấp & giá/ }).click();
    await page.getByTestId("gd1-manual-open").click();
    await page.getByTestId("gd1-m-sup").fill(`${TAG} NCC giá tay`);
    await page.getByTestId("gd1-m-price").fill("95000");
    await page.getByTestId("gd1-m-save").click();
    // NCC hiện ở cả "So sánh giá" lẫn "Đánh giá nhà cung cấp" ⇒ lấy dòng đầu
    await expect(page.getByRole("cell", { name: `${TAG} NCC giá tay` }).first()).toBeVisible();
  });
});
