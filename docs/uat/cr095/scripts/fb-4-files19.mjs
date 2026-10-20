// UAT CR-095 · FileBox riêng · (c) 19 file đã gắn bằng mgmt-import --filebox mở được: /file-link → /_fb/d/<id> (qua nginx của web) — demo-owner.
import { chromium, ctx, login, snap, log, CW } from "./fb-lib.mjs";
const ids = process.argv.slice(2);
const b = await chromium.launch(); const c = await ctx(b); const p = await c.newPage();
let bearer = null; p.on("request", (r) => { const a = r.headers()["authorization"]; if (a) bearer = a; });
await login(p, "demo-owner"); await p.goto(CW + "/contracts"); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(2000);
const res = [];
for (const id of ids) {
  const r1 = await p.request.get(`${CW}/pack/contracts/contracts/${id}/file-link`, { headers: { authorization: bearer } });
  const j = r1.ok() ? await r1.json() : {}; const url = j.url ?? "";
  if (!url) { res.push({ id: id.slice(0, 8), link: r1.status() }); continue; }
  const r2 = await p.request.get(CW + url); const body = await r2.body();
  res.push({ id: id.slice(0, 8), link: 200, rel: url.startsWith("/_fb/d/"), dl: r2.status(), bytes: body.length, magic: body.subarray(0, 4).toString("latin1").replace(/[^ -~]/g, "?"), disp: /attachment/.test(r2.headers()["content-disposition"] ?? "") });
}
log({ step: "files19", total: res.length, ok: res.filter((x) => x.dl === 200 && x.rel && x.bytes > 0).length, res });
// ảnh: HĐ có file — trang chi tiết với "Xem file gốc"
await p.goto(`${CW}/contracts/${ids[0]}`); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(2000);
log({ step: "detail-with-file", shot: await snap(p, "11-detail-imported-file") });
await b.close();