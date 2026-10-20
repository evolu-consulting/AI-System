// UAT CR-095 · FileBox riêng · kiểm lại nút "Xem file gốc" sau fix (không gọi AI): HĐ đã nhập (19) + HĐ tải lên.
import { chromium, ctx, login, snap, log, CW } from "./fb-lib.mjs";
const [imp, upl] = process.argv.slice(2);
const b = await chromium.launch(); const c = await ctx(b); const p = await c.newPage();
await login(p, "demo-owner");
for (const [tag, id] of [["imported", imp], ["uploaded", upl]]) {
  await p.goto(`${CW}/contracts/${id}`); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(2500);
  const [pop] = await Promise.all([c.waitForEvent("page", { timeout: 10000 }).catch(() => null), p.getByText("Xem file gốc").first().click()]);
  let st = null, disp = null, final = null;
  if (pop) { const r = await pop.waitForResponse((x) => x.url().includes("/_fb/d/"), { timeout: 10000 }).catch(() => null); if (r) { st = r.status(); disp = r.headers()["content-disposition"] ?? null; } await pop.waitForTimeout(1500); final = pop.url().replace(/\?.*$/, "?…"); }
  await p.waitForTimeout(1500);
  log({ step: `open-file-${tag}`, popup: !!pop, fbStatus: st, disp: disp && disp.slice(0, 40), popupUrl: final, error: /Có lỗi xảy ra/.test(await p.locator("body").innerText()), shot: await snap(p, `12-open-${tag}`) });
  if (pop) await pop.close().catch(() => {});
}
await b.close();