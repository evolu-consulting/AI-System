// Luồng 9 · price-scout trên máy chủ (CÓ GHI — chỉ cấu hình dò giá của một SP demo + một lượt dò thật): mở Sản phẩm & Giá → SP đầu
// tiên (nhóm có tab NCC) → tab "Nhà cung cấp & giá" → "Cấu hình dò giá": đặt từ khoá E2E, lịch tắt, Lưu ⇒ thấy "Đã dùng X/Y lượt";
// bấm "Tìm giá trên thị trường" → "Tìm" ⇒ có kết quả hoặc thông báo không tìm thấy (agent thật, tìm web) ⇒ bộ đếm lượt tăng 1.
// Cần: hub migrate 0052 + contracts 0040 + `hub:seed` (agent `price-scout`). Chạy: e2e-deployed.ps1 -Spec e2e/deployed/09-price-scout.deployed.ts
import type { Page } from "@playwright/test";
import { CW, expect, login, settle, TAG, test } from "./_support";

let page: Page;

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

const usedOf = async (): Promise<number> => {
  const t = (await page.getByTestId("scout-usage").textContent()) ?? "";
  return Number(/Đã dùng\s+(\d+)/.exec(t)?.[1] ?? Number.NaN);
};

test.describe("09 price-scout", () => {
  test("cấu hình dò giá SP demo ⇒ dò ⇒ kết quả + bộ đếm lượt", async () => {
    test.setTimeout(300_000);
    await page.goto(`${CW}/products`);
    await settle(page);
    await page.getByRole("row").nth(1).click();
    await page.getByRole("tab", { name: /Nhà cung cấp & giá/ }).click();
    const panel = page.getByTestId("scout-panel");
    await expect(panel.getByRole("heading", { name: "Cấu hình dò giá" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("scout-keywords").fill(`${TAG} giá bán`);
    await page.getByTestId("scout-schedule").selectOption("off");
    const saved = page.waitForResponse(
      (r) => r.url().includes("/price-scout") && r.request().method() === "PUT",
    );
    await page.getByTestId("scout-save").click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByTestId("scout-usage")).toContainText(/Đã dùng \d+\//);
    const before = await usedOf();

    await page.getByRole("button", { name: /Tìm giá trên thị trường/ }).click();
    const found = page.waitForResponse((r) => r.url().includes("/suppliers/search"), {
      timeout: 240_000,
    });
    await page.getByTestId("scout-search-run").click();
    const res = await found;
    expect([200, 429]).toContain(res.status());
    if (res.status() === 200) {
      const dlg = page.locator("dialog[open]");
      await expect(dlg.getByText(/Lưu vào bảng so sánh|Không tìm thấy/)).toBeVisible({
        timeout: 30_000,
      });
      await dlg.getByRole("button", { name: "Đóng" }).click();
      await expect.poll(usedOf, { timeout: 30_000 }).toBe(before + 1);
    } else {
      await expect(page.getByRole("alert")).toContainText(/hết lượt dò giá/i);
    }
  });
});
