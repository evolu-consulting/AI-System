// X1-AC08 (combine) · S7 · HUB-FR-95 / HUB-BR-20 / H2a-R13 (phân xử T9, test-plan §7.1): cờ `side_effect` chỉ buộc hỏi
// xác nhận khi **agent gọi tool qua MCP** (agent `need_input` [Đồng ý, Huỷ]); lệnh `/` do user tự gõ = ý định trực tiếp
// ⇒ Hub chạy thẳng, cờ chỉ để KHÔNG retry. Admin bật cờ cho `mock-send` ⇒ chat `/mock-send xin chào` ra kết quả mock,
// không có AskCard, Dify mock nhận đúng 1 lời gọi. Đường agent→MCP cần Runtime (stack combine không có) ⇒ kiểm tay ở
// `docs/guides/combine-test.md` S7; chip "Đồng ý/Huỷ" đã có ở `e2e/chat/x1-confirm.chat.ts` + int H2a A67.
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

test("X1-AC08 · bật 'Cần xác nhận trước khi chạy' cho mock-send ⇒ lệnh /mock-send user tự gõ vẫn chạy thẳng (không AskCard), đúng 1 lời gọi Dify, không retry", async ({
  browser,
}) => {
  // 1. Admin bật cờ.
  const adminCtx = await browser.newContext({ baseURL: ADMIN_URL, locale: "vi-VN" });
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.goto(`${ADMIN_URL}/workflows/${X1_IDS.wfSend}`);
  const sw = admin.getByRole("switch", { name: "Cần xác nhận trước khi chạy" });
  await expect(sw).toBeVisible();
  await sw.click();
  const saved = admin.waitForResponse(
    (r) =>
      r.url().includes(`/admin/workflows/${X1_IDS.wfSend}`) && r.request().method() === "PATCH",
  );
  await admin.getByRole("button", { name: "Lưu", exact: true }).click();
  expect((await saved).status()).toBe(200);
  // Cờ đã lưu (mở lại trang vẫn bật).
  await admin.reload();
  await expect(admin.getByRole("switch", { name: "Cần xác nhận trước khi chạy" })).toBeChecked();
  await adminCtx.close();

  // 2. Chat (lan) gõ lệnh ⇒ chạy thẳng: kết quả mock, không AskCard, đúng 1 lời gọi Dify (không retry).
  const base = (await difyRuns()).length;
  const chatCtx = await browser.newContext({ locale: "vi-VN" });
  const page = await chatCtx.newPage();
  await chatLogin(page, "lan");
  await sendChat(page, "/mock-send xin chào");
  await expect(chatLog(page)).toContainText(MOCK_TEXT, { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Consultant cần thêm thông tin" })).toHaveCount(0);
  const runs = (await difyRuns()).slice(base);
  expect(runs).toHaveLength(1);
  expect(JSON.stringify(runs[0]?.body)).toContain("xin chào");
  await chatCtx.close();
});
