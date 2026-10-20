// UAT CR-095 · FileBox riêng (sohoptac2, tenant demo) · (a) tải DOCX qua UI + AI trích xuất (1 lượt AI) · (b) "Đọc lại" 1 lần.
import { chromium, ctx, login, snap, log, CW } from "./fb-lib.mjs";
const DOCX = "F:/workspace/evolu-platform/reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx";
const b = await chromium.launch(); const c = await ctx(b); const p = await c.newPage();
const net = []; p.on("response", (r) => { const u = new URL(r.url()); if (r.request().method() !== "GET" && !/\.(js|css)$/.test(u.pathname) && !u.pathname.startsWith("/auth/")) net.push(`${r.request().method()} ${u.pathname} ${r.status()}`); });
await login(p, "demo-owner"); await p.goto(CW + "/contracts"); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(2500);
const [fc] = await Promise.all([p.waitForEvent("filechooser", { timeout: 10000 }), p.getByRole("button", { name: /Thêm hợp đồng/ }).first().click()]);
const t0 = Date.now(); await fc.setFiles(DOCX);
await p.waitForTimeout(4000); await snap(p, "01-upload-progress");
await p.waitForURL(/\/contracts\/[0-9a-f-]{36}/, { timeout: 240000 }).catch(() => {});
await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(3000);
const url = p.url();
log({ step: "upload-extract", ms: Date.now() - t0, url, net: [...net], text: (await p.locator("body").innerText()).slice(0, 900).replace(/\n+/g, " | "), shot: await snap(p, "02-upload-result") });
// (b) Đọc lại đúng 1 lần
const reread = p.getByRole("button", { name: /Đọc lại/ }); const n = await reread.count();
let note = "không có nút Đọc lại";
if (n) { net.length = 0; await reread.first().click(); const t1 = Date.now(); await p.waitForTimeout(3000); await snap(p, "03-reread-progress");
  await p.waitForTimeout(25000); await p.waitForLoadState("networkidle").catch(() => {}); note = `ms~${Date.now() - t1}`; }
log({ step: "reread", button: n, note, net: [...net], text: (await p.locator("body").innerText()).slice(0, 1200).replace(/\n+/g, " | "), shot: await snap(p, "04-reread-result") });
await b.close();