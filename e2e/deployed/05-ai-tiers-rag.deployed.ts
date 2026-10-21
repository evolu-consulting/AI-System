// Luồng 5 · ai-tiers-rag (chat-web, AI thật trên sohoptac2, tenant demo): (a) RAG tài liệu nội bộ — hỏi chính sách ⇒ trả lời
// nêu ĐÚNG dữ kiện của tài liệu giả QC-TC-01 (demo-ai-fix.ts) + tên nguồn; (b) câu xã giao xong, Điều phối dùng bậc nhanh
// (model của bước Điều phối trong SSE = haiku khi metadata có model); (c) câu hỏi dữ liệu hợp đồng xong, không lỗi.
// Chỉ đọc (hội thoại mới không gắn thẻ dọn — giống 03). Cần: deploy lát ai-tiers-rag + hub seed + demo-ai-fix --apply.
import type { Page, Response } from "@playwright/test";
import { CHAT, chatTurn, expect, login, settle, test } from "./_support";

const ERR_UI =
  /Đã xảy ra lỗi|Không gửi được|không thể trả lời|Something went wrong|Lỗi kết nối|quá tải|hết lượt|ALL_PROVIDERS_EXHAUSTED/i;

type SseEvent = { event: string; data: Record<string, unknown> };

function parseSse(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const frame of text.split(/\r?\n\r?\n/)) {
    let event = "";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!event || data.length === 0) continue;
    try {
      out.push({ event, data: JSON.parse(data.join("\n")) as Record<string, unknown> });
    } catch {
      // khung hỏng: bỏ qua
    }
  }
  return out;
}

/** SSE của mọi lượt gửi tin trên trang (để đọc agent + model của từng bước). */
function recordRuns(page: Page): Promise<SseEvent[]>[] {
  const runs: Promise<SseEvent[]>[] = [];
  page.on("response", (r: Response) => {
    const u = new URL(r.url());
    if (r.request().method() === "POST" && /\/conversations\/[^/]+\/messages$/.test(u.pathname))
      runs.push(r.text().then(parseSse, () => []));
  });
  return runs;
}

/** `{key, model}` của các bước đã chạy (sự kiện `step.started`). */
function steps(evs: SseEvent[]): { key: string; model: string | null }[] {
  return evs
    .map((e) => e.data.agent as { key?: string; model?: string | null } | undefined)
    .filter((a): a is { key: string; model?: string | null } => typeof a?.key === "string")
    .map((a) => ({ key: a.key, model: a.model ?? null }));
}

async function ask(page: Page, text: string): Promise<string> {
  const all = await chatTurn(page, text);
  const i = all.lastIndexOf(text);
  return i < 0 ? all : all.slice(i + text.length);
}

test.describe("05 ai-tiers-rag (chat-web, AI thật)", () => {
  let chat: Page;
  let runs: Promise<SseEvent[]>[];
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({
      locale: "vi-VN",
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    chat = await ctx.newPage();
    runs = recordRuns(chat);
    await login(chat, CHAT);
    await settle(chat);
  });
  test.afterAll(async () => {
    await chat.context().close();
  });

  test("RAG tài liệu nội bộ: hạn mức duyệt + chính sách Minh Phát ⇒ đúng dữ kiện QC-TC-01 kèm tên nguồn", async () => {
    await chat.goto(`${CHAT}/c/new`);
    const r = await ask(
      chat,
      "Theo tài liệu nội bộ, quy định hạn mức duyệt hợp đồng theo giá trị là gì, và đối tác Bao bì Minh Phát được thanh toán trong bao nhiêu ngày? Nêu nguồn.",
    );
    expect(r).not.toMatch(ERR_UI);
    expect(r, "thiếu ngưỡng 500 triệu").toMatch(/500 triệu|500\.000\.000/);
    expect(r, "thiếu cấp duyệt Giám đốc").toMatch(/Giám đốc/);
    expect(r, "thiếu thời hạn thanh toán Minh Phát").toMatch(/15 ngày/);
    expect(r, "thiếu tên tài liệu nguồn").toMatch(/QC-TC-01|Quy chế tài chính/);
    expect(r).not.toMatch(/không (có|tìm thấy) tài liệu/i);
  });

  test("câu xã giao: có trả lời, Điều phối chạy bậc nhanh (haiku); ghi lại các bước đã chạy", async () => {
    await chat.goto(`${CHAT}/c/new`);
    const before = runs.length;
    const r = await ask(chat, "Chào bạn, cảm ơn nhé!");
    expect(r.trim().length).toBeGreaterThan(2);
    expect(r).not.toMatch(ERR_UI);
    const s = steps((await Promise.all(runs.slice(before)))[0] ?? []);
    test.info().annotations.push({ type: "steps-smalltalk", description: JSON.stringify(s) });
    const orch = s.filter((x) => x.key === "orchestrator");
    // Metadata có model ⇒ Điều phối phải ở bậc nhanh. Dự phòng (làn haiku cooldown ⇒ sonnet) cũng làm đỏ — có chủ đích.
    for (const o of orch) if (o.model) expect(o.model).toMatch(/haiku/i);
  });

  test("câu hỏi dữ liệu hợp đồng: có trả lời theo dữ liệu, không lỗi", async () => {
    await chat.goto(`${CHAT}/c/new`);
    const r = await ask(
      chat,
      "Có bao nhiêu hợp đồng của đối tác Thực phẩm Hưng Phát? Trả lời ngắn.",
    );
    expect(r.trim().length).toBeGreaterThan(5);
    expect(r).not.toMatch(ERR_UI);
    expect(r).toMatch(/Hưng Phát|\d+/);
  });
});
