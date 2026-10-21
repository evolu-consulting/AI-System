// Luồng 10 · "Góp ý về app" gửi từ contracts-web → thấy ở admin-web (đổi trạng thái + trả lời) → user thấy phản hồi; và "Xem hợp đồng gốc"
// của HĐ demo c1 (seed-demo-v2 nạp PDF mẫu khi có SEED_FILEBOX_*). Góp ý tạo ra gắn tiền tố E2E-DEPLOY và được đặt "Xong" trong `finally`.
import type { Page } from "@playwright/test";
import { ADMIN, CW, expect, login, settle, TAG, test } from "./_support";

const MSG = `${TAG} góp ý tự động ${Date.now()}`;

/** Đặt Xong mọi góp ý E2E-DEPLOY còn mở ở admin-web (không còn "Mới" trong hộp thư admin). */
async function closeFeedback(page: Page): Promise<void> {
  await login(page, ADMIN);
  await page.goto(`${ADMIN}/feedback`);
  await settle(page);
  const rows = page.getByRole("row", { name: new RegExp(TAG) });
  for (let i = 0; i < 20 && (await rows.count()) > 0; i++) {
    const row = rows.first();
    if (/Xong/.test(await row.innerText())) break;
    await row.click();
    await page.getByRole("dialog").getByLabel("Trạng thái").selectOption("done");
    await page.getByRole("dialog").getByRole("button", { name: "Lưu" }).click();
    await settle(page);
    await page.keyboard.press("Escape").catch(() => {});
  }
}

test.describe("10 góp ý + hợp đồng gốc", () => {
  test("gửi góp ý ở contracts-web, admin-web thấy và trả lời, user thấy phản hồi", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CW);
    await settle(page);
    try {
      await page.getByRole("button", { name: "Góp ý về app" }).click();
      const panel = page
        .getByRole("complementary", { name: "Góp ý về app" })
        .or(page.getByRole("dialog"));
      await panel.getByLabel("Loại").selectOption("bug");
      await panel.getByLabel("Nội dung").fill(MSG);
      await panel.getByRole("button", { name: "Gửi góp ý" }).click();
      await expect(panel.getByText(/Cảm ơn/)).toBeVisible();

      await login(page, ADMIN);
      await page.goto(`${ADMIN}/feedback`);
      await settle(page);
      await page.getByRole("row", { name: new RegExp(MSG) }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByLabel("Trạng thái").selectOption("in_progress");
      await sheet.getByLabel("Phản hồi").fill(`${TAG} đã nhận, đang xử lý`);
      await sheet.getByRole("button", { name: "Lưu" }).click();
      await expect(page.getByRole("row", { name: new RegExp(MSG) })).toContainText("Đang xử lý");

      await page.goto(`${CW}/overview`);
      await settle(page);
      await page.getByRole("button", { name: "Góp ý về app" }).click();
      await page.getByRole("button", { name: "Đã gửi" }).click();
      await expect(page.getByText(`${TAG} đã nhận, đang xử lý`)).toBeVisible();
    } finally {
      await closeFeedback(page).catch(() => {});
    }
  });

  test("HĐ demo có tệp gốc: «Xem hợp đồng gốc» mở khung PDF + nút tải", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CW);
    await page.goto(`${CW}/contracts`);
    await settle(page);
    await page.getByRole("link", { name: /NCCA/ }).first().click();
    await page.getByRole("link", { name: /Xem hợp đồng gốc/ }).click();
    const dlg = page.getByRole("dialog", { name: "Hợp đồng gốc" });
    await expect(dlg.locator("iframe")).toBeVisible({ timeout: 30_000 });
    await expect(dlg.getByRole("link", { name: "Tải xuống" })).toBeVisible();
  });
});
