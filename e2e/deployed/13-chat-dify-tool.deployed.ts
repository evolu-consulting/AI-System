// Luồng 13 · chat THƯỜNG (không gõ lệnh /): trợ lý chọn tool workflow Dify `dify-han-muc-duyet` theo MÔ TẢ của tool (không từ khoá
// trong prompt) và trả lời theo kết quả. Xác minh tool THẬT SỰ được gọi: Admin API ghi dify_run trigger=agent, status=ok sau thời
// điểm bắt đầu (không phải trả lời từ tài liệu QC-TC-01). Cần Dify thật, app đã Publish. Chỉ đọc.
import { CHAT, chatTurn, difyRuns, expect, login, settle, test } from "./_support";

const WF = "dify-han-muc-duyet";
const Q = "Hợp đồng mua 600 triệu thì ai phải duyệt?";
const Q_MISSING = "Hợp đồng này ai phải duyệt?";

async function newChat(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
  await login(page, CHAT);
  await settle(page);
  await page.goto(`${CHAT}/c/new`);
}
const replyOf = (all: string, q: string) => all.slice(Math.max(0, all.lastIndexOf(q)) + q.length);

test.describe("13 chat thường → tool workflow Dify", () => {
  test("hỏi tự nhiên có đủ dữ kiện ⇒ gọi tool (dify_run agent/ok mới) và nêu Giám đốc", async ({
    page,
  }) => {
    const start = new Date(Date.now() - 2_000).toISOString();
    await newChat(page);
    const reply = replyOf(await chatTurn(page, Q), Q);
    expect(reply).toMatch(/Giám đốc/);
    expect(reply).not.toMatch(/Đã xảy ra lỗi|Không gửi được|NOT_CONFIGURED|UPSTREAM_ERROR/i);
    const fresh = (await difyRuns(WF)).filter((r) => r.at >= start && r.trigger === "agent");
    expect(fresh.map((r) => r.status)).toContain("ok");
  });

  test("thiếu giá trị hợp đồng ⇒ trợ lý hỏi lại giá trị, KHÔNG gọi tool", async ({ page }) => {
    const start = new Date(Date.now() - 2_000).toISOString();
    await newChat(page);
    const reply = replyOf(await chatTurn(page, Q_MISSING), Q_MISSING);
    expect(reply).toMatch(/giá trị|bao nhiêu|số tiền/i);
    expect(reply).toMatch(/\?/);
    const fresh = (await difyRuns(WF)).filter((r) => r.at >= start && r.trigger === "agent");
    expect(fresh).toHaveLength(0);
  });
});
