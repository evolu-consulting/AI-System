// Dọn phòng tạm "UAT X2b …" của julian.bui (chủ nhóm) qua UI chat-web. Không đụng "Evolu team"/DM.
import { chromium, CHAT, PW, login } from "./lib.mjs";
const b = await chromium.launch();
const c = await b.newContext({ locale: "vi-VN", viewport: { width: 1280, height: 800 } });
await c.addInitScript(() => { try { localStorage.setItem("ai.locale", "vi"); } catch {} });
const p = await c.newPage();
await login(p, CHAT, "evolu", "julian.bui", PW, (u) => !u.pathname.startsWith("/login")); await p.reload();
const reg = p.getByRole("region", { name: "Tin nhắn & Nhóm" });
await reg.getByRole("link", { name: "Evolu team", exact: true }).waitFor({ timeout: 20000 });
let n = 0;
for (;;) {
  const l = reg.getByRole("link", { name: /^UAT X2b/ }).first();
  if (!(await l.count())) break;
  await l.click();
  await p.getByRole("button", { name: "Tuỳ chọn phòng" }).click();
  await p.getByRole("menuitem", { name: /Xoá nhóm/ }).click();
  await p.getByRole("alertdialog").getByRole("button", { name: "Xoá", exact: true }).click();
  await p.waitForTimeout(1500); n++;
  if (n > 12) break;
}
console.log("đã xoá", n, "phòng tạm; còn:", await reg.getByRole("link").allInnerTexts());
await b.close();
