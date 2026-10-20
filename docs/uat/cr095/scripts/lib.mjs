import { chromium } from "file:///F:/workspace/evolu-platform/node_modules/@playwright/test/index.mjs";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
export const OUT = "F:/workspace/evolu-platform/docs/uat/cr095";
export const CW = "http://127.0.0.1:13300", AW = "http://127.0.0.1:13000", CH = "http://127.0.0.1:13100";
export const PW = "dev-password-1";
export const results = [];
export async function browser() { return chromium.launch(); }
export async function ctxFor(b, { w = 1440, h = 900, dark = false } = {}) {
  const c = await b.newContext({ locale: "vi-VN", viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light", timezoneId: "Asia/Ho_Chi_Minh" });
  await c.addInitScript((d) => { try { localStorage.setItem("ai.locale", "vi"); localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  return c;
}
export async function loginCw(page, user, pw = PW) {
  await page.goto(CW + "/login");
  await page.getByRole("textbox", { name: "Email" }).waitFor();
  const tenant = page.getByRole("textbox", { name: "Mã công ty" });
  if (await tenant.count()) await tenant.fill("acme");
  await page.getByRole("textbox", { name: "Email" }).fill(user);
  await page.locator("input[name=password]").fill(pw);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}
export async function snap(page, name) { mkdirSync(OUT + "/shots", { recursive: true }); await page.screenshot({ path: `${OUT}/shots/${name}.png` }); return `shots/${name}.png`; }
export async function step(feature, user, fn, page) {
  const t = Date.now(); let r = { feature, user, result: "OK", evidence: "", note: "" };
  try { const x = await fn(); if (x) Object.assign(r, x); } catch (e) {
    r.result = "LỖI"; r.note = String(e.message).split("\n")[0].slice(0, 250);
    if (page) { try { r.evidence = await snap(page, "FAIL-" + feature.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) + "-" + user); } catch {} }
  }
  console.log(r.result, "|", feature, "|", user, "|", r.note); results.push(r); appendFileSync(OUT + "/results.jsonl", JSON.stringify(r) + "\n"); return r;
}export async function dump(page, name) { const t = await page.locator("body").innerText(); mkdirSync(OUT + "/dumps", { recursive: true }); writeFileSync(`${OUT}/dumps/${name}.txt`, t); return t; }export const STATE = (u) => `C:/Users/Admin/AppData/Local/Temp/claude/F--workspace/17d5e1ac-0105-4a7b-9d6a-8a2983b3bccc/scratchpad/state-${u}.json`;
export async function userPage(b, user, opt = {}) {
  const c = await b.newContext({ storageState: STATE(user), locale: "vi-VN", viewport: { width: opt.w ?? 1440, height: opt.h ?? 900 }, colorScheme: opt.dark ? "dark" : "light", timezoneId: "Asia/Ho_Chi_Minh" });
  await c.addInitScript((d) => { try { localStorage.setItem("ai.locale", "vi"); localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, !!opt.dark);
  const p = await c.newPage();
  await p.goto(CW + "/contracts"); await p.waitForTimeout(1200);
  if (p.url().includes("/login")) { await loginCw(p, user); console.log("  (đăng nhập lại " + user + ": phiên lưu đã hết hiệu lực)"); }
  return { c, p, done: async () => { try { await c.storageState({ path: STATE(user) }); } catch {} await c.close(); } };
}export const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
export const settle = async (p, ms = 1800) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(ms); };
export const body = (p) => p.locator("body").innerText();
export const rows = (p) => p.locator("table tbody tr");
const A = "http://127.0.0.1:13001", H = "http://127.0.0.1:14000";
export async function apiTok(user, pw = PW, tenant = "acme") { const r = await fetch(A + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_key: tenant, username: user, password: pw }) }); return (await r.json()).access_token; }
export async function hub(tok, m, path, b) { const r = await fetch(H + "/pack/contracts" + path, { method: m, headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: b === undefined ? undefined : JSON.stringify(b) }); const x = await r.text(); let j = {}; try { j = JSON.parse(x); } catch {} return { s: r.status, j }; }