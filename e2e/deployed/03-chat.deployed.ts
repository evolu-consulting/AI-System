// Luồng 3 · chat THẬT (AI do gói Claude trên máy chủ): hỏi dữ liệu hợp đồng, nói chuyện thường, hỏi theo tài liệu (RAG), dùng tool hợp đồng.
// Kiểm lỏng: có trả lời, không lỗi, có tên thực thể demo. Timeout rộng. Chỉ đọc (không ghi dữ liệu).
import type { Page } from "@playwright/test";
import { CHAT, CW, chatTurn, expect, login, settle, test } from "./_support";

// ALL_PROVIDERS_EXHAUSTED = gói Claude trên máy chủ hết lượt (môi trường, không phải lỗi giao diện) — vẫn tính là FAIL, đừng giả xanh.
const ERR_UI =
  /Đã xảy ra lỗi|Không gửi được|không thể trả lời|Something went wrong|Lỗi kết nối|quá tải|hết lượt|ALL_PROVIDERS_EXHAUSTED/i;

/** Phần chữ SAU tin nhắn người dùng vừa gửi (trả lời của AI). */
function reply(all: string, sent: string): string {
  const i = all.lastIndexOf(sent);
  return i < 0 ? all : all.slice(i + sent.length);
}

async function ask(page: Page, text: string): Promise<string> {
  const all = await chatTurn(page, text);
  return reply(all, text);
}

test.describe("03 chat (chat-web, AI thật)", () => {
  let chat: Page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({
      locale: "vi-VN",
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    chat = await ctx.newPage();
    await login(chat, CHAT);
    await settle(chat);
  });
  test.afterAll(async () => {
    await chat.context().close();
  });

  test("hỏi dữ liệu hợp đồng: trả lời nêu tên đối tác/hợp đồng demo thật", async () => {
    await chat.goto(`${CHAT}/c/new`);
    const r = await ask(
      chat,
      "Liệt kê 3 hợp đồng đang hiệu lực trong hệ thống kèm tên đối tác. Dùng công cụ tra cứu hợp đồng.",
    );
    expect(r.trim().length).toBeGreaterThan(40);
    expect(r).not.toMatch(ERR_UI);
    expect(r).toMatch(
      /Hưng Phát|Hưng Thịnh|Bình An|Viettel|Minh Phát|Phương Nam|Bếp Việt|Đà Lạt|CKS|chữ ký số/i,
    );
  });

  test("nói chuyện thường / ngoài chủ đề: trả lời hợp lý, không lỗi", async () => {
    await chat.goto(`${CHAT}/c/new`);
    const r = await ask(chat, "Xin chào! Bạn khỏe không? Kể ngắn một câu đùa về mùa thu.");
    expect(r.trim().length).toBeGreaterThan(10);
    expect(r).not.toMatch(ERR_UI);
  });

  test("RAG theo tài liệu: hỏi nội dung hợp đồng bao bì Minh Phát, có trích nguồn", async () => {
    await chat.goto(`${CHAT}/c/new`);
    const r = await ask(
      chat,
      "Theo hợp đồng bao bì Minh Phát (BB-MP-2026-27), giá trị hợp đồng và thời hạn hiệu lực là gì? Nêu nguồn.",
    );
    expect(r.trim().length).toBeGreaterThan(40);
    expect(r).not.toMatch(ERR_UI);
    expect(r).toMatch(/211\.248\.000|Minh Phát|BB-MP-2026-27/);
    // Trích dẫn: tên tài liệu/nguồn hoặc đánh số [1].
    expect(r).toMatch(/HD-bao-bi-Minh-Phat|BB-MP-2026-27|Nguồn|nguồn|\[\d+\]/);
  });

  test("dùng tool hợp đồng từ chat: có dấu vết gọi công cụ hoặc kết quả theo dữ liệu thật", async () => {
    await chat.goto(`${CHAT}/c/new`);
    const r = await ask(
      chat,
      "Dùng công cụ hợp đồng: có bao nhiêu hợp đồng của đối tác Thực phẩm Hưng Phát? Trả lời ngắn.",
    );
    expect(r.trim().length).toBeGreaterThan(10);
    expect(r).not.toMatch(ERR_UI);
    expect(r).toMatch(/Hưng Phát|\d+ hợp đồng/i);
  });
});

test.describe("03 trợ lý AI nhúng trong contracts-web (tool hợp đồng)", () => {
  test("mở trợ lý, hỏi hợp đồng sắp hết hạn ⇒ trả lời theo dữ liệu demo", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(page, CW);
    await settle(page);
    await page.getByRole("button", { name: "Mở trợ lý AI" }).click();
    const r = await ask(
      page,
      "Hợp đồng nào sắp hết hạn? Liệt kê tối đa 3 hợp đồng kèm ngày hết hạn.",
    );
    expect(r.trim().length).toBeGreaterThan(30);
    expect(r).not.toMatch(ERR_UI);
    expect(r).toMatch(
      /\d{1,2}\/\d{1,2}\/20\d\d|20\d\d-\d\d-\d\d|Hưng Phát|Bình An|CKS|chữ ký số|Viettel/i,
    );
  });
});
