// Dang nhap moi user qua UI 1 lan, luu storageState (tiet kiem tran dang nhap theo IP) + chup man hinh dang nhap.
import { writeFileSync } from "node:fs";
import { browser, ctxFor, loginCw, snap, step, STATE, CW } from "./lib.mjs";
const b = await browser();
for (const u of (process.argv[2] ? process.argv[2].split(",") : ["chu", "soan", "xem", "han", "lan", "hoa"])) {
  const c = await ctxFor(b); const p = await c.newPage();
  await step("Đăng nhập UI", u, async () => { await loginCw(p, u); await p.locator("nav, aside").first().waitFor(); await c.storageState({ path: STATE(u) }); return { evidence: u === "chu" ? await snap(p, "01-login-ok-chu-desktop-light") : "" }; }, p);
  await c.close();
}
await b.close();