import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";
export const OUT = "D:/AI/ai-system/docs/specs/P-b-sources/evidence/2026-10-11";
export const ADMIN = "http://localhost:3000", CHAT = "http://localhost:3100";
export const results = [];
export async function launch() { return chromium.launch({ headless: true }); }
export async function ctx(b, base) { const c = await b.newContext({ locale: "vi-VN", viewport: { width: 1360, height: 860 }, baseURL: base }); await c.addInitScript(() => { try { localStorage.setItem("ai.locale", "vi"); } catch {} }); return c; }
export async function step(id, title, page, fn) {
  try { await fn(); results.push({ id, title, ok: true }); console.log("PASS", id, title); }
  catch (e) { results.push({ id, title, ok: false, err: String(e).slice(0, 400) }); console.log("FAIL", id, title, String(e).slice(0, 300)); try { await page.screenshot({ path: `${OUT}/FAIL-${id}.png`, fullPage: true }); } catch {} }
}
export const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
export async function adminLogin(p, tenant, user, pw = "1234567890") {
  await p.goto("/login");
  await p.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(pw);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}
export const save = () => fs.writeFileSync(`${OUT}/result-${process.argv[1].replaceAll("\\", "/").split("/").pop()}.json`, JSON.stringify(results, null, 1));
