import { chromium, expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
export { expect };
export const STUDIO = "http://localhost:3200/studio";
export const ADMIN = "http://localhost:3000";
export const CHAT = "http://localhost:3100";
export const KH = "http://localhost:4030";
export const KH_KEY = "mock-kh-key";
export const PW = "1234567890";
const origins = [STUDIO, ADMIN, CHAT].map((o) => new URL(o).origin);
export const storage = (lang = "vi") => ({ cookies: [], origins: origins.map((origin) => ({ origin, localStorage: ["ai.locale", "studio.locale"].map((name) => ({ name, value: lang })) })) });
export async function launch(out, viewport = { width: 1280, height: 800 }, lang = "vi") {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, locale: lang === "vi" ? "vi-VN" : "en-US", storageState: storage(lang) });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3200" });
  const page = await ctx.newPage();
  return { browser, ctx, page };
}
export const mkSnap = (out) => async (p, name, full = false) => { await p.waitForTimeout(450); return p.screenshot({ path: `${out}/${name}.png`, fullPage: full }); };
export function mkStep(out, pages, snap) {
  const log = [];
  const step = async (id, title, fn) => {
    const t0 = Date.now();
    try { await fn(); log.push({ id, title, ok: true, ms: Date.now() - t0 }); console.log("PASS", id, title); }
    catch (e) {
      const err = String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400);
      log.push({ id, title, ok: false, err }); console.log("FAIL", id, title, "::", err);
      for (const [k, p] of Object.entries(pages())) await snap(p, `${id}-FAIL-${k}`).catch(() => {});
    }
  };
  return { step, log, save: (n = "result") => writeFileSync(`${out}/${n}.json`, JSON.stringify(log, null, 2)) };
}
export async function studioLogin(p, user = "admin", tenant = "platform") {
  await p.goto(`${STUDIO}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByRole("textbox", { name: "Mật khẩu" }).fill(PW);
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL((u) => !u.pathname.endsWith("/login"));
}
export async function adminLogin(p, user, tenant) {
  await p.goto(`${ADMIN}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByRole("textbox", { name: "Mật khẩu" }).fill(PW);
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL((u) => !u.pathname.endsWith("/login"));
}
export async function chatLogin(p, user, tenant = "evolu") {
  await p.goto(`${CHAT}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByRole("textbox", { name: "Mật khẩu" }).fill(PW);
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL((u) => !u.pathname.endsWith("/login"));
}
export const ROOM = "d2a00000-0000-4000-8000-000000000002";
// Bắt đầu quy trình bằng "!key msg" trong phòng Evolu team (chat-web, người thật). Trả về { runId }.
import { sql as _sql } from "./sql.mjs";
export async function startRun(p, key, msg, snap, prefix) {
  await p.goto(`${CHAT}/rooms/${ROOM}`);
  const box = p.getByRole("textbox", { name: /Tin nhắn cho/ }); await box.waitFor();
  const before = _sql("select count(*) from hub.process_runs");
  await box.fill(`!${key} ${msg}`);
  if (snap) await snap(p, `${prefix}-form`);
  await p.getByRole("button", { name: "Gửi", exact: true }).click();
  for (let i = 0; i < 30; i++) { if (_sql("select count(*) from hub.process_runs") !== before) break; await p.waitForTimeout(1000); }
  return { runId: _sql("select id from hub.process_runs order by started_at desc limit 1") };
}
export async function waitRun(runId, re, secs = 240) {
  let st = "";
  for (let i = 0; i < secs; i++) { st = _sql(`select status from hub.process_runs where id='${runId}'`); if (re.test(st)) return st; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error(`run ${runId} kẹt ${st}`);
}
