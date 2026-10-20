// UAT CR-095 · FileBox riêng · tiếp: đợi AI trích xuất xong HĐ vừa tải, mở "Xem file gốc" (qua /_fb), "Đọc lại" đúng 1 lần.
import { chromium, ctx, login, snap, log, CW } from "./fb-lib.mjs";
const ID = process.argv[2];
const b = await chromium.launch(); const c = await ctx(b); const p = await c.newPage();
const net = []; p.on("response", (r) => { const u = new URL(r.url()); if (r.request().method() !== "GET" && !/\.(js|css)$/.test(u.pathname) && !u.pathname.startsWith("/auth/")) net.push(`${r.request().method()} ${u.pathname} ${r.status()}`); if (u.pathname.startsWith("/_fb/")) net.push(`GET /_fb/d/<id> ${r.status()}`); });
await login(p, "demo-owner"); await p.goto(`${CW}/contracts/${ID}`);
const t0 = Date.now(); let done = false;
for (let i = 0; i < 60 && !done; i++) { await p.waitForTimeout(5000); const t = await p.locator("body").innerText(); done = !/Đang đọc hợp đồng|Đang xử lý hợp đồng/.test(t); }
await p.waitForTimeout(1500);
const body1 = await p.locator("body").innerText();
log({ step: "extract-done", ms: Date.now() - t0, done, text: body1.slice(0, 1500).replace(/\n+/g, " | "), shot: await snap(p, "05-extract-result") });
// file gốc
const [pop] = await Promise.all([c.waitForEvent("page", { timeout: 8000 }).catch(() => null), p.getByText("Xem file gốc").first().click()]);
await p.waitForTimeout(4000);
log({ step: "open-file", popup: pop ? pop.url().replace(/\?.*$/, "?…") : null, net: [...net], shot: await snap(p, "06-open-file") });
if (pop) await pop.close().catch(() => {});
// Đọc lại
const reread = p.getByRole("button", { name: /Đọc lại/ }); const n = await reread.count(); let ok = false; const t1 = Date.now();
if (n) { net.length = 0; await reread.first().click(); await p.waitForTimeout(3000); await snap(p, "07-reread-progress");
  for (let i = 0; i < 48 && !ok; i++) { await p.waitForTimeout(5000); ok = !/Đang đọc hợp đồng|Đang xử lý hợp đồng/.test(await p.locator("body").innerText()); } }
await p.waitForTimeout(1500);
log({ step: "reread", button: n, done: ok, ms: Date.now() - t1, net: [...net], text: (await p.locator("body").innerText()).slice(0, 1500).replace(/\n+/g, " | "), shot: await snap(p, "08-reread-result") });
await b.close();