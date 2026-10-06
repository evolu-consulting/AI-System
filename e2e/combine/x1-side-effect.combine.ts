// X1-AC08 (combine) · S7 · HUB-FR-95: admin bật cờ `side_effect` của workflow `mock-send` ⇒ trong ≤ 10 s chat `/mock-send xin chào`
// hiện AskCard; "Huỷ" ⇒ Dify mock 0 lời gọi; lần 2 "Đồng ý" ⇒ đúng 1 lời gọi và kết quả MOCK_TEXT (test-plan §2 AC08, §4).
import { expect, test } from "@playwright/test";
import {
  ADMIN_URL,
  adminLogin,
  chatLog,
  chatLogin,
  difyRuns,
  MOCK_TEXT,
  sendChat,
  X1_IDS,
} from "./_support";

test("X1-AC08 · bật 'Cần xác nhận trước khi chạy' cho mock-send ⇒ chat hỏi Đồng ý/Huỷ; Huỷ = 0 lời gọi Dify; Đồng ý = đúng 1 lời gọi", async ({
  browser,
}) => {
  const base = (await difyRuns()).length;
  // 1. Admin bật cờ.
  const adminCtx = await browser.newContext({ baseURL: ADMIN_URL, locale: "vi-VN" });
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.goto(`${ADMIN_URL}/workflows/${X1_IDS.wfSend}`);
  const sw = admin.getByRole("switch", { name: "Cần xác nhận trước khi chạy" });
  await expect(sw).toBeVisible();
  await sw.click();
  const saved = admin.waitForResponse(
    (r) => r.url().includes(`/admin/workflows/${X1_IDS.wfSend}`) && r.request().method() === "PUT",
  );
  await admin.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await adminCtx.close();

  // 2. Chat (lan) gõ lệnh ⇒ AskCard trong ≤ 10 s; Huỷ ⇒ chưa gọi Dify.
  const chatCtx = await browser.newContext({ locale: "vi-VN" });
  const page = await chatCtx.newPage();
  await chatLogin(page, "lan");
  await sendChat(page, "/mock-send xin chào");
  const ask = page.getByRole("region", { name: "Consultant cần thêm thông tin" });
  await expect(ask).toBeVisible({ timeout: 10_000 });
  await ask.getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect(chatLog(page)).toContainText("Huỷ");
  expect((await difyRuns()).length - base).toBe(0);

  // 3. Lần 2: Đồng ý ⇒ đúng 1 lời gọi, kết quả mock.
  await page.goto("/c/new");
  await sendChat(page, "/mock-send xin chào");
  const ask2 = page.getByRole("region", { name: "Consultant cần thêm thông tin" });
  await expect(ask2).toBeVisible({ timeout: 10_000 });
  await ask2.getByRole("button", { name: "Đồng ý", exact: true }).click();
  await expect(chatLog(page)).toContainText(MOCK_TEXT, { timeout: 20_000 });
  expect((await difyRuns()).length - base).toBe(1);
  await chatCtx.close();
});
