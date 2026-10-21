// Luồng 13 · dify-demo-flow: hỏi trong chat THƯỜNG (không gõ lệnh /) — trợ lý gọi tool workflow Dify `dify-han-muc-duyet`
// (đã gắn vào `assistant` bằng `hub:seed` sau `dify-register`). Cần Dify thật. Chỉ đọc. Chưa chạy trong lát.
import { CHAT, chatTurn, expect, login, settle, test } from "./_support";

const Q = "Hợp đồng mua 600 triệu thì ai phải duyệt?";

test.describe("13 chat thường → tool workflow Dify", () => {
  test("demo-owner hỏi tự nhiên ⇒ câu trả lời nêu Giám đốc", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CHAT);
    await settle(page);
    await page.goto(`${CHAT}/c/new`);
    const all = await chatTurn(page, Q);
    const reply = all.slice(Math.max(0, all.lastIndexOf(Q)) + Q.length);
    expect(reply).toMatch(/Giám đốc/);
    expect(reply).not.toMatch(/Đã xảy ra lỗi|Không gửi được|NOT_CONFIGURED|UPSTREAM_ERROR/i);
  });
});
