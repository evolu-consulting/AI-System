// Luồng 8 · my-activity-rag (AI thật trên server): trợ lý trả lời từ hoạt động / lịch sử chat của CHÍNH người hỏi.
// (a) AI System: hỏi một câu có mã riêng, rồi ở hội thoại mới hỏi "Hôm nay tôi đã hỏi AI những gì?" ⇒ câu trả lời nêu lại câu đã
//     hỏi (tool `my-chat-history`, role user, hôm nay). (b) Khoang Trợ lý AI trong Sổ Hợp Tác: "Lịch sử thay đổi của hợp đồng
//     2023/12-MP" ⇒ trả lời có số HĐ + mốc thời gian (tool `my-activity` contract = số, chỉ HĐ demo-owner xem được).
// Cần: deploy lát my-activity-rag (hub 0050 + contracts 0038) + `hub:seed` (agents.yaml có my-activity, my-chat-history).
// Chỉ VIẾT, chưa chạy (Luật 0b).
import type { Page } from "@playwright/test";
import { CHAT, CW, chatTurn, expect, login, settle, test } from "./_support";

const ERR_UI =
  /Đã xảy ra lỗi|Không gửi được|không thể trả lời|Something went wrong|Lỗi kết nối|quá tải|ALL_PROVIDERS_EXHAUSTED/i;

/**
 * Câu trả lời = phần sau lần cuối câu hỏi xuất hiện. Câu hỏi PHẢI duy nhất mỗi lượt chạy (`tag`): câu trả lời liệt kê lịch sử
 * chat có thể trích nguyên văn câu hỏi giống hệt của lượt chạy trước (sohoptac2 2026-10-21: "09:33 | Hôm nay tôi đã hỏi AI những
 * gì?" trong bảng ⇒ `lastIndexOf` cắt mất nửa đầu bảng, gồm dòng có mã kiểm tra). Câu đang hỏi không nằm trong kết quả tool
 * (`excludeRun`) nên chuỗi có `tag` chỉ còn ở bong bóng câu hỏi.
 */
async function ask(page: Page, text: string): Promise<string> {
  const all = await chatTurn(page, text);
  const i = all.lastIndexOf(text);
  return i < 0 ? all : all.slice(i + text.length);
}
const tag = () => `lượt ${Date.now().toString(36)}`;

test.describe("08 my-activity-rag (AI thật, dữ liệu của chính người hỏi)", () => {
  test("AI System: 'Hôm nay tôi đã hỏi AI những gì?' ⇒ nêu lại câu đã hỏi hôm nay", async ({
    page,
  }) => {
    const mark = `MYACT${Date.now().toString(36).toUpperCase()}`;
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CHAT);
    await settle(page);
    await page.goto(`${CHAT}/c/new`);
    const first = await ask(page, `Xin chào, hãy ghi nhớ mã kiểm tra ${mark} giúp tôi.`);
    expect(first).not.toMatch(ERR_UI);
    await page.goto(`${CHAT}/c/new`);
    await settle(page);
    const r = await ask(page, `Hôm nay tôi đã hỏi AI những gì? (${tag()})`);
    expect(r.trim().length).toBeGreaterThan(30);
    expect(r).not.toMatch(ERR_UI);
    expect(r, "phải nêu lại câu đã hỏi (có mã kiểm tra)").toContain(mark);
  });

  test("Sổ Hợp Tác (khoang Trợ lý AI): lịch sử thay đổi của HĐ 2023/12-MP ⇒ có số HĐ + mốc thời gian", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CW);
    await settle(page);
    await page.getByRole("button", { name: "Mở trợ lý AI" }).click();
    const r = await ask(page, `Lịch sử thay đổi của hợp đồng 2023/12-MP (${tag()})`);
    expect(r.trim().length).toBeGreaterThan(40);
    expect(r).not.toMatch(ERR_UI);
    expect(r, "thiếu số hợp đồng").toContain("2023/12-MP");
    expect(r, "thiếu mốc thời gian").toMatch(/\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{4}-\d{2}-\d{2}/);
    expect(r, "không được nói không có quyền/không tìm thấy").not.toMatch(
      /không tìm thấy hợp đồng|không có quyền/i,
    );
  });
});
