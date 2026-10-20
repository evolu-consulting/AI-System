// UAT CR-095 · FileBox riêng · (b) demo-editor (nhóm duyệt cấp 1; chỉ thấy HĐ của phòng mình) tải DOCX (1 lượt AI) rồi "Đọc lại" đúng 1 lần (1 lượt AI).
import { chromium, ctx, login, snap, log, CW } from "./fb-lib.mjs";
const DOCX = "F:/workspace/evolu-platform/reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx";
const b = await chromium.launch(); const c = await ctx(b); const p = await c.newPage();
let bearer = null; p.on("request", (r) => { const a = r.headers()["authorization"]; if (a) bearer = a; });
const net = []; p.on("response", (r) => { const u = new URL(r.url()); if (r.request().method() !== "GET" && !/\.(js|css)$/.test(u.pathname) && !u.pathname.startsWith("/auth/")) net.push(`${r.request().method()} ${u.pathname} ${r.status()}`); });
await login(p, "demo-editor"); await p.goto(CW + "/contracts"); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(2500);
const [fc] = await Promise.all([p.waitForEvent("filechooser", { timeout: 10000 }), p.getByRole("button", { name: /Thêm hợp đồng/ }).first().click()]);
await fc.setFiles(DOCX); await p.waitForURL(/\/contracts\/[0-9a-f-]{36}/, { timeout: 60000 });
let done = false; for (let i = 0; i < 48 && !done; i++) { await p.waitForTimeout(5000); done = !/Đang đọc hợp đồng|Đang xử lý hợp đồng/.test(await p.locator("body").innerText()); }
await p.waitForTimeout(2000); log({ step: "editor-upload-extract", done, id: p.url().split("/").pop(), net: [...net], shot: await snap(p, "06b-editor-extract") });
const redo = p.locator('[data-approval="redo"]'); const n = await redo.count();
log({ step: "before-reread", button: n, shot: await snap(p, "07-before-reread") });
let ok = false; const t1 = Date.now();
if (n) { await redo.first().click(); await p.locator("#approval-reason").fill("Kiểm tra lại các dòng hàng hoá và tổng giá trị.");
  await snap(p, "08-reread-reason"); net.length = 0; await p.locator('form[data-approval="reason"] button[type=submit]').click(); await p.waitForTimeout(3000); await snap(p, "09-reread-progress");
  for (let i = 0; i < 48 && !ok; i++) { await p.waitForTimeout(5000); ok = !/Đang đọc hợp đồng|Đang xử lý hợp đồng/.test(await p.locator("body").innerText()); } }
await p.waitForTimeout(1500);
log({ step: "reread", button: n, done: ok, ms: Date.now() - t1, net: [...net], text: (await p.locator("body").innerText()).slice(0, 700).replace(/\n+/g, " | "), shot: await snap(p, "10-reread-result") });
await b.close();
