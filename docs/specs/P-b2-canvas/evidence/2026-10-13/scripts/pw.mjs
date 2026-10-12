import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
export const EVD = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
export const results = [];
export async function mkCtx(browser, viewport = { width: 1440, height: 900 }) { return browser.newContext({ locale: "vi-VN", viewport }); }
export function runner(prefix, getPages) {
  return async function step(id, title, fn) {
    try { await fn(); results.push({ id, title, ok: true }); console.log("PASS", id, title); }
    catch (e) {
      results.push({ id, title, ok: false, err: String(e.message).slice(0, 500) }); console.log("FAIL", id, title, "\n  ", String(e.message).slice(0, 400));
      let i = 0; for (const [n, pg] of Object.entries(getPages())) { try { await pg.screenshot({ path: `${EVD}/FAIL-${prefix}-${id}-${n}.png` }); } catch {} i++; }
    }
  };
}
export const shot = (p, name) => p.screenshot({ path: `${EVD}/${name}.png` });
export { chromium };
export const LOCALE_STATE = { cookies: [], origins: ["http://localhost:3000","http://localhost:3100"].map(o=>({origin:o,localStorage:[{name:"ai.locale",value:"vi"}]})) };
export async function viCtx(browser, viewport = { width: 1440, height: 900 }) { return browser.newContext({ locale: "vi-VN", viewport, storageState: LOCALE_STATE }); }
export async function adminLogin(p, user, tenant = "evolu") {
  await p.goto("http://localhost:3000/login");
  await p.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByLabel("Mật khẩu", { exact: true }).fill("1234567890");
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}
export async function openDef(p, key, name) {
  await p.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
  await p.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: key }).getByRole("link", { name }).click();
  await p.waitForLoadState("networkidle");
}
