// Luồng 6 · app-guide (AI thật trên server): agent hướng dẫn dùng sản phẩm bằng tool `app-guide` — trả lời có TÊN MENU/NÚT THẬT.
// (a) AI System: "tạo hợp đồng mới + AI đọc file" ⇒ nêu Sổ Hợp Tác › Hợp đồng › Upload hợp đồng; (b) khoang Trợ lý AI trong Sổ Hợp Tác:
// "xem điểm uy tín đối tác ở đâu" ⇒ nêu menu Đối tác + Tổng quan/Điểm uy tín. Chỉ đọc (hội thoại mới không gắn thẻ dọn như 03).
// Cần: deploy lát app-guide + `hub:seed` (agents.yaml có app-guide). Chỉ VIẾT, chưa chạy (Luật 0b).
import type { Page } from "@playwright/test";
import { CHAT, CW, chatTurn, expect, login, settle, test } from "./_support";

const ERR_UI =
  // Không có "hết lượt": hướng dẫn hợp lệ có nhắc thông báo "Đã hết lượt thao tác AI hôm nay"; lỗi máy chủ thật vẫn bắt qua mã.
  /Đã xảy ra lỗi|Không gửi được|không thể trả lời|Something went wrong|Lỗi kết nối|quá tải|ALL_PROVIDERS_EXHAUSTED/i;

async function ask(page: Page, text: string): Promise<string> {
  const all = await chatTurn(page, text);
  const i = all.lastIndexOf(text);
  return i < 0 ? all : all.slice(i + text.length);
}

test.describe("06 app-guide (AI thật, hướng dẫn dùng sản phẩm)", () => {
  test("AI System: tạo hợp đồng mới + AI đọc file ⇒ nêu đúng menu Hợp đồng / Upload hợp đồng", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CHAT);
    await settle(page);
    await page.goto(`${CHAT}/c/new`);
    const r = await ask(page, "Làm sao để tạo hợp đồng mới và để AI đọc file hợp đồng?");
    expect(r.trim().length).toBeGreaterThan(60);
    expect(r).not.toMatch(ERR_UI);
    expect(r, "thiếu menu Hợp đồng").toMatch(/Hợp đồng/);
    expect(r, "thiếu nút Upload hợp đồng").toMatch(/Upload hợp đồng/);
    expect(r, "thiếu tên app Sổ Hợp Tác").toMatch(/Sổ Hợp Tác/);
    expect(r, "câu trả lời phải là các bước đánh số").toMatch(/(^|\n)\s*1[.)]/);
  });

  test("Sổ Hợp Tác (khoang Trợ lý AI): xem điểm uy tín đối tác ở đâu ⇒ nêu menu Đối tác + Điểm uy tín", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CW);
    await settle(page);
    await page.getByRole("button", { name: "Mở trợ lý AI" }).click();
    const r = await ask(page, "Xem điểm uy tín đối tác ở đâu?");
    expect(r.trim().length).toBeGreaterThan(40);
    expect(r).not.toMatch(ERR_UI);
    expect(r, "thiếu menu Đối tác").toMatch(/Đối tác/);
    expect(r, "thiếu Điểm uy tín").toMatch(/Điểm uy tín|uy tín/i);
    expect(r, "thiếu tab Tổng quan hoặc Cài đặt").toMatch(/Tổng quan|Cài đặt/);
  });
});
