// UAT CR-095 · AI that (sohoptac2, tenant demo) · (b) "Doc lai" tren HĐ da nhap + (c) 2 luot tro ly AI nhung (tool hop dong).
import { chromium, ctx, login, snap, log, CW } from "./real-ai-lib.mjs";
const b = await chromium.launch(); const c = await ctx(b); const p = await c.newPage();
const net = []; p.on("response", async (r) => { const u = new URL(r.url()); if (r.request().method() !== "GET" && !/\.(js|css)$/.test(u.pathname) && !u.pathname.startsWith("/auth/")) net.push(`${r.request().method()} ${u.pathname} ${r.status()}`); });
await login(p, "demo-owner"); await p.goto(CW + "/contracts"); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(2000);
// (b) mo HĐ docx da nhap, bam "Doc lai" neu co
await p.getByText("BB-MP-2026-27").first().click(); await p.waitForURL(/\/contracts\/[0-9a-f-]{36}/, { timeout: 15000 }); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(1500);
const reread = p.getByRole("button", { name: /Đọc lại/ });
const n = await reread.count();
let note = "khong co nut Doc lai"; 
if (n) { net.length = 0; await reread.first().click(); await p.waitForTimeout(8000); note = (await p.locator("body").innerText()).match(/(Không[^\n]{0,120}|Đang[^\n]{0,80}|Lỗi[^\n]{0,120})/)?.[0] ?? "(khong thay thong bao)"; }
log({ step: "doc-lai", button: n, net: [...net], note, shot: await snap(p, "02-reread") });
// (c) chat nhung
async function turn(text, tag) {
  const tb = p.getByRole("textbox").last(); await tb.fill(text); net.length = 0; await p.keyboard.press("Enter");
  const t0 = Date.now(); await p.waitForTimeout(3000);
  await p.getByRole("button", { name: /^(Dừng|Stop)/ }).waitFor({ state: "detached", timeout: 280000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const txt = await p.locator("body").innerText();
  log({ step: tag, ms: Date.now() - t0, net: [...net], tail: txt.slice(-1800).replace(/\n+/g, " | "), shot: await snap(p, tag) });
}
await p.goto(CW + "/contracts"); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(1500);
const bt = p.getByRole("button", { name: "Mở trợ lý AI" }); if (await bt.count()) await bt.click(); await p.waitForTimeout(1200);
await turn("Hợp đồng nào sắp hết hạn? Dùng công cụ tra cứu hợp đồng và liệt kê tối đa 5 hợp đồng kèm ngày hết hạn.", "03-chat-turn1");
await turn("Trong các hợp đồng đó, hợp đồng nào có giá trị lớn nhất? Trả lời ngắn gọn.", "04-chat-turn2");
await b.close();