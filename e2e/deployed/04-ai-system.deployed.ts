// Luồng 4 · AI System (chat-web) trọn vẹn + trang quản trị (admin-web) chủ công ty mở được.
// Dữ liệu ghi: chỉ hội thoại gắn thẻ E2E-DEPLOY (tạo qua giao diện, dọn cuối bằng giao diện). Chat AI thật (gói Claude trên máy chủ).
import type { Page, Response } from "@playwright/test";
import {
  ADMIN,
  bodyText,
  CHAT,
  CW,
  chatTurn,
  expect,
  login,
  settle,
  TAG,
  test,
  watchConsole,
} from "./_support";

const ERR_UI =
  /Đã xảy ra lỗi|Không gửi được|không thể trả lời|Something went wrong|Lỗi kết nối|quá tải|hết lượt|ALL_PROVIDERS_EXHAUSTED/i;

/**
 * Lỗi đáng kể của một trang: lỗi console (trừ dòng "Failed to load resource", đã tính theo phản hồi) + phản hồi ≥ 400.
 * Bỏ qua có chủ ý: `/processes`, `/process-defs` 404 (engine quy trình tắt trên máy chủ, web dò cờ) và `/auth/refresh` 401 (chưa đăng nhập).
 */
function watchApp(page: Page): { take(): string[] } {
  const errs = watchConsole(page);
  const list: string[] = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (r.status() < 400 || r.status() >= 500) return;
    if (r.status() === 404 && /^\/(processes|process-defs)$/.test(u.pathname)) return;
    if (r.status() === 401 && u.pathname === "/auth/refresh") return;
    list.push(`HTTP ${r.status()} ${r.request().method()} ${u.pathname}`);
  });
  return {
    /** Trả lỗi tích luỹ rồi xoá. */
    take(): string[] {
      const out = [...errs.list.filter((m) => !/Failed to load resource/.test(m)), ...list];
      errs.list.length = 0;
      list.length = 0;
      return out;
    },
  };
}

type SseEvent = { event: string; data: Record<string, unknown> };

/** Phân tích thân SSE (`id:/event:/data:`) của một lượt gửi. */
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

/** Ghi lại mọi lượt `POST /conversations/:id/messages` (SSE) của trang để đọc agent đã trả lời. */
function recordRuns(page: Page): { runs: Promise<SseEvent[]>[] } {
  const rec: { runs: Promise<SseEvent[]>[] } = { runs: [] };
  page.on("response", (r: Response) => {
    const u = new URL(r.url());
    if (r.request().method() === "POST" && /\/conversations\/[^/]+\/messages$/.test(u.pathname))
      rec.runs.push(r.text().then(parseSse, () => []));
  });
  return rec;
}

/** Khoá agent đã chạy trong một lượt: `responder` (run trực tiếp) + agent trong các bước. */
function agentKeys(evs: SseEvent[]): string[] {
  const keys = new Set<string>();
  for (const e of evs) {
    const resp = e.data.responder as { agent?: string } | undefined;
    if (resp?.agent) keys.add(resp.agent);
    const ag = e.data.agent as { key?: string } | undefined;
    if (ag?.key) keys.add(ag.key);
  }
  return [...keys];
}

function reply(all: string, sent: string): string {
  const i = all.lastIndexOf(sent);
  return i < 0 ? all : all.slice(i + sent.length);
}

async function ask(page: Page, text: string): Promise<string> {
  return reply(await chatTurn(page, text), text);
}

const convLinks = (page: Page, re: RegExp) =>
  page.locator("nav a[href^='/c/']").filter({ hasText: re });

/** Xoá (bằng giao diện) mọi hội thoại gắn thẻ E2E-DEPLOY còn trong thanh bên. */
async function cleanTagged(page: Page): Promise<void> {
  await page.goto(`${CHAT}/c/new`);
  await settle(page);
  for (let i = 0; i < 20; i++) {
    const row = convLinks(page, new RegExp(TAG)).first();
    if (!(await row.count())) return;
    const li = row.locator("xpath=..");
    await li.hover();
    await li.getByRole("button", { name: "Thao tác khác" }).click();
    await page.getByRole("menuitem", { name: "Xoá" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Xoá" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await settle(page);
  }
}

test.describe
  .serial("04 AI System (chat-web)", () => {
    let chat: Page;
    let errs: ReturnType<typeof watchApp>;
    let rec: ReturnType<typeof recordRuns>;

    test.beforeAll(async ({ browser }) => {
      const ctx = await browser.newContext({
        locale: "vi-VN",
        viewport: { width: 1440, height: 900 },
      });
      await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
      chat = await ctx.newPage();
      errs = watchApp(chat);
      rec = recordRuns(chat);
      await login(chat, CHAT);
      await settle(chat);
      await cleanTagged(chat); // sót từ lần chạy hỏng trước
    });
    test.afterAll(async () => {
      try {
        await cleanTagged(chat);
      } finally {
        await chat.context().close();
      }
    });

    test("đăng nhập: trang chào, ô nhập, danh sách hội thoại, không lỗi console", async () => {
      await chat.goto(`${CHAT}/c/new`);
      await settle(chat);
      expect(await bodyText(chat)).toMatch(/Chào Demo|hôm nay cần gì/i);
      await expect(chat.getByRole("textbox").last()).toBeVisible();
      await expect(chat.getByRole("button", { name: "Đính kèm tệp" })).toBeVisible();
      expect(errs.take()).toEqual([]);
    });

    let convUrl = "";
    test("hội thoại mới: nói chuyện thường ⇒ có trả lời, URL /c/<id>, xuất hiện trong danh sách", async () => {
      await chat.goto(`${CHAT}/c/new`);
      const q = `${TAG} chào buổi sáng, trả lời đúng một câu ngắn.`;
      const r = await ask(chat, q);
      expect(r.trim().length).toBeGreaterThan(5);
      expect(r).not.toMatch(ERR_UI);
      await expect(chat).toHaveURL(/\/c\/[0-9a-f-]{36}/);
      convUrl = chat.url();
      await expect(convLinks(chat, new RegExp(TAG)).first()).toBeVisible();
    });

    test("lịch sử: tải lại trang vẫn thấy hội thoại, mở lại hiện nội dung cũ", async () => {
      await chat.goto(`${CHAT}/c/new`);
      await settle(chat);
      const row = convLinks(chat, new RegExp(TAG)).first();
      await expect(row).toBeVisible();
      await row.click();
      await expect(chat).toHaveURL(convUrl);
      await expect(chat.locator("body")).toContainText("chào buổi sáng");
      await chat.reload();
      await settle(chat);
      await expect(chat.locator("body")).toContainText("chào buổi sáng");
    });

    test("đổi tên hội thoại gắn thẻ ⇒ tiêu đề mới hiện trong danh sách", async () => {
      await chat.goto(convUrl);
      await settle(chat);
      const row = convLinks(chat, new RegExp(TAG)).first();
      const li = row.locator("xpath=..");
      await li.hover();
      await li.getByRole("button", { name: "Thao tác khác" }).click();
      await chat.getByRole("menuitem", { name: "Đổi tên" }).click();
      const box = chat.getByRole("textbox", { name: "Tên hội thoại" });
      await box.fill(`${TAG} tên mới`);
      await chat.getByRole("button", { name: "Lưu" }).click();
      await expect(convLinks(chat, /E2E-DEPLOY tên mới/).first()).toBeVisible();
      await chat.reload();
      await settle(chat);
      await expect(convLinks(chat, /E2E-DEPLOY tên mới/).first()).toBeVisible();
    });

    test("xoá hội thoại gắn thẻ (có hộp xác nhận, huỷ thì còn) ⇒ biến mất khỏi danh sách", async () => {
      await chat.goto(convUrl);
      await settle(chat);
      const row = convLinks(chat, /E2E-DEPLOY tên mới/).first();
      const li = row.locator("xpath=..");
      await li.hover();
      await li.getByRole("button", { name: "Thao tác khác" }).click();
      await chat.getByRole("menuitem", { name: "Xoá" }).click();
      await chat.getByRole("alertdialog").getByRole("button", { name: "Huỷ" }).click();
      await expect(convLinks(chat, /E2E-DEPLOY tên mới/).first()).toBeVisible();
      await li.hover();
      await li.getByRole("button", { name: "Thao tác khác" }).click();
      await chat.getByRole("menuitem", { name: "Xoá" }).click();
      await chat.getByRole("alertdialog").getByRole("button", { name: "Xoá" }).click();
      await expect(convLinks(chat, /E2E-DEPLOY tên mới/)).toHaveCount(0);
      await chat.reload();
      await settle(chat);
      await expect(convLinks(chat, /E2E-DEPLOY tên mới/)).toHaveCount(0);
    });

    test("tải tệp lên rồi hỏi về tệp (RAG theo tệp): trả lời nêu đúng dữ kiện trong tệp", async () => {
      await chat.goto(`${CHAT}/c/new`);
      await settle(chat);
      const fact = "ZX-4417";
      const body = [
        `Biên bản thử nghiệm ${TAG}`,
        `Mã dự án duy nhất của biên bản này là ${fact}.`,
        "Ngân sách phê duyệt: 987.654.321 đồng. Người phụ trách: bà Lâm Thu Hà.",
      ].join("\n");
      await chat.locator("input[type=file]").setInputFiles({
        name: `${TAG}-bien-ban.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(body, "utf8"),
      });
      await expect(chat.locator("body")).toContainText(`${TAG}-bien-ban.txt`);
      await expect(chat.getByText("Đang tải lên")).toHaveCount(0, { timeout: 60_000 });
      const r = await ask(
        chat,
        `${TAG} Trong tệp đính kèm, mã dự án là gì và ngân sách phê duyệt bao nhiêu? Nêu nguồn.`,
      );
      expect(r).not.toMatch(ERR_UI);
      // Demo được cấp agent chung `assistant` (có Read/Grep) ⇒ phải đọc được tệp: nêu ĐÚNG mã + ngân sách trong tệp, kèm nguồn
      // (tên tệp). Không chấp nhận "chưa đọc được" hay bịa số khác. (Cấp quyền: demo-ai-fix.ts trên máy chủ.)
      await expect(chat.locator("body")).toContainText(`${TAG}-bien-ban.txt`);
      expect(r, "thiếu mã dự án trong tệp").toContain(fact);
      expect(r, "thiếu ngân sách trong tệp").toMatch(/987\.654\.321|987,654,321|987654321/);
      expect(r, "thiếu trích dẫn nguồn (tên tệp/biên bản)").toMatch(
        /bien-ban|biên bản|tệp đính kèm|nguồn/i,
      );
    });

    test("cùng MỘT agent: @mgmt-assistant gọi từ AI System và từ khoang trợ lý Sổ Hợp Tác đều do agent mgmt-assistant trả lời", async ({
      browser,
    }) => {
      // AI System: gắn thẻ agent trực tiếp.
      await chat.goto(`${CHAT}/c/new`);
      const before = rec.runs.length;
      const r = await ask(
        chat,
        `@mgmt-assistant ${TAG} có bao nhiêu hợp đồng của đối tác Thực phẩm Hưng Phát? Trả lời ngắn.`,
      );
      expect(r).not.toMatch(ERR_UI);
      const fromChat = agentKeys((await Promise.all(rec.runs.slice(before)))[0] ?? []);
      expect(fromChat).toContain("mgmt-assistant");

      // Sổ Hợp Tác: khoang trợ lý (gửi `@mgmt-assistant …` mặc định).
      const ctx = await browser.newContext({
        locale: "vi-VN",
        viewport: { width: 1440, height: 900 },
      });
      await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
      const cw = await ctx.newPage();
      try {
        const cwRec = recordRuns(cw);
        await login(cw, CW);
        await settle(cw);
        await cw.getByRole("button", { name: "Mở trợ lý AI" }).click();
        const r2 = await ask(
          cw,
          `${TAG} có bao nhiêu hợp đồng của đối tác Thực phẩm Hưng Phát? Trả lời ngắn.`,
        );
        expect(r2).not.toMatch(ERR_UI);
        const fromCw = agentKeys((await Promise.all(cwRec.runs))[0] ?? []);
        expect(fromCw).toContain("mgmt-assistant");
        expect(fromCw.filter((k) => k === "mgmt-assistant")).toEqual(
          fromChat.filter((k) => k === "mgmt-assistant"),
        );
      } finally {
        await ctx.close();
      }
    });

    test("tin không gắn thẻ ở AI System: định tuyến theo mặc định của tenant, có trả lời, ghi lại agent đã chạy", async () => {
      await chat.goto(`${CHAT}/c/new`);
      const before = rec.runs.length;
      const r = await ask(chat, `${TAG} liệt kê tên 2 đối tác có hợp đồng trong hệ thống.`);
      expect(r).not.toMatch(ERR_UI);
      expect(r.trim().length).toBeGreaterThan(20);
      const keys = agentKeys((await Promise.all(rec.runs.slice(before)))[0] ?? []);
      test.info().annotations.push({
        type: "agents-untagged",
        description: keys.join(",") || "(orchestrator)",
      });
    });

    test("app switcher: AI System → Sổ Hợp Tác → AI System → Quản trị, không đăng nhập lại", async () => {
      await chat.goto(`${CHAT}/c/new`);
      await settle(chat);
      await chat.getByRole("button", { name: "Ứng dụng" }).click();
      await chat.getByRole("menuitem", { name: "Sổ Hợp Tác" }).click();
      await chat.waitForURL((u) => u.href.startsWith(CW) && !u.pathname.startsWith("/login"), {
        timeout: 45_000,
      });
      await expect(chat.getByRole("link", { name: "Tổng quan" }).first()).toBeVisible();
      await chat.getByRole("button", { name: "Ứng dụng" }).click();
      await chat.getByRole("menuitem", { name: "AI System" }).click();
      await chat.waitForURL((u) => u.href.startsWith(CHAT), { timeout: 45_000 });
      await settle(chat);
      await expect(chat).not.toHaveURL(/\/login/);
      await chat.getByRole("button", { name: "Ứng dụng" }).click();
      await chat.getByRole("menuitem", { name: "Quản trị" }).click();
      await chat.waitForURL((u) => u.href.startsWith(ADMIN) && !u.pathname.startsWith("/login"), {
        timeout: 45_000,
      });
      await settle(chat);
      await expect(chat.locator("input[type=password]")).toHaveCount(0);
    });
  });

// Trang quản trị chủ công ty (demo-owner) mở được (/features, /secrets là việc của quản trị nền tảng ⇒ chủ công ty bị từ chối đúng): không về /login, không lỗi console / HTTP 5xx.
const ADMIN_PAGES = [
  "/",
  "/users",
  "/groups",
  "/access",
  "/agents",
  "/sources",
  "/commands",
  "/workflows",
  "/processes",
  "/usage",
  "/audit",
];
test.describe("04 admin-web (chủ công ty)", () => {
  test("các trang quản trị mở được, không lỗi console", async ({ browser }) => {
    const ctx = await browser.newContext({
      locale: "vi-VN",
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    const page = await ctx.newPage();
    try {
      await login(page, CHAT);
      await settle(page);
      await page.getByRole("button", { name: "Ứng dụng" }).click();
      await page.getByRole("menuitem", { name: "Quản trị" }).click();
      await page.waitForURL((u) => u.href.startsWith(ADMIN) && !u.pathname.startsWith("/login"), {
        timeout: 45_000,
      });
      await settle(page); // chờ đổi mã SSO xong trước khi tải lại (tránh huỷ giữa chừng khi xoay refresh token)
      const e = watchApp(page);
      const bad: string[] = [];
      for (const p of ADMIN_PAGES) {
        await page.goto(`${ADMIN}${p}`);
        await settle(page);
        const u = new URL(page.url());
        if (u.pathname.startsWith("/login")) bad.push(`${p}: về /login`);
        else if (!(await page.locator("main, [role=main], h1, h2").first().isVisible()))
          bad.push(`${p}: trống`);
        const t = await bodyText(page);
        if (/Something went wrong|Đã xảy ra lỗi|không có quyền|Forbidden/i.test(t))
          bad.push(
            `${p}: ${t.match(/Something went wrong|Đã xảy ra lỗi|không có quyền|Forbidden/i)?.[0]}`,
          );
        for (const m of e.take()) bad.push(`${p}: ${m}`);
      }
      expect(bad).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
