// UAT CR-095 · AI that (sohoptac2, tenant demo) · buoc 0: dang nhap + xem danh sach + thu tai DOCX (khong goi AI neu FileBox loi).
import { chromium, ctx, login, snap, log, CW } from "./real-ai-lib.mjs";
const DOCX = "F:/workspace/evolu-platform/reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx";
const b = await chromium.launch(); const c = await ctx(b); const p = await c.newPage();
const net = []; p.on("response", (r) => { const u = new URL(r.url()); if (r.request().method() !== "GET" && !/\.(js|css)$/.test(u.pathname)) net.push(`${r.request().method()} ${u.pathname} ${r.status()}`); });
await login(p, "demo-owner"); await p.goto(CW + "/contracts"); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(2500);
log({ step: "list", url: p.url(), rows: await p.locator("table tbody tr").count(), shot: await snap(p, "00-list") });
const [fc] = await Promise.all([p.waitForEvent("filechooser", { timeout: 10000 }), p.getByRole("button", { name: /Thêm hợp đồng/ }).first().click()]);
await fc.setFiles(DOCX); await p.waitForTimeout(8000);
const t = await p.locator("body").innerText();
log({ step: "upload", net, text: t.slice(0, 600).replace(/\n+/g, " | "), shot: await snap(p, "01-upload") });
await b.close();