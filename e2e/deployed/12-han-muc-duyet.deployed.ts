// Luồng 12 · dify-demo-flow: lệnh `/han-muc-duyet` gọi workflow Dify THẬT (không LLM) — hợp đồng Mua 600 triệu ⇒ chuỗi duyệt
// có Giám đốc ký. Cần đã chạy `dify-register` (xem tasks.md). Chỉ đọc (lệnh không ghi dữ liệu nghiệp vụ). Chưa chạy trong lát.
import { CHAT, chatTurn, expect, login, settle, test } from "./_support";

const CMD = "/han-muc-duyet 600000000 Mua";

test.describe("12 /han-muc-duyet (Dify workflow thật)", () => {
  test("demo-owner gõ lệnh trong Chat AI ⇒ trả lời liệt kê Giám đốc", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CHAT);
    await settle(page);
    await page.goto(`${CHAT}/c/new`);
    const all = await chatTurn(page, CMD);
    const reply = all.slice(Math.max(0, all.lastIndexOf(CMD)) + CMD.length);
    expect(reply).toMatch(/Giám đốc/);
    expect(reply).toMatch(/Kế toán trưởng/);
    expect(reply).toMatch(/600\.000\.000/);
    expect(reply).not.toMatch(/Đã xảy ra lỗi|Không gửi được|NOT_CONFIGURED|UPSTREAM_ERROR/i);
  });
});
