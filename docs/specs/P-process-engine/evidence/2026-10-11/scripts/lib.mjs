import { chromium, expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
export { expect };
export const OUT = "D:/AI/ai-system/docs/specs/P-process-engine/evidence/2026-10-11/shots";
mkdirSync(OUT, { recursive: true });
export const CHAT = "http://localhost:3100", ADMIN = "http://localhost:3000";
export const USERS = {
  lan: { u: "lan", pw: "dev-password-1" }, hoa: { u: "hoa", pw: "dev-password-1" },
  minh: { u: "minh", pw: "Uat-pass-12345" }, tadmin: { u: "tadmin", pw: "Uat-pass-12345" },
};
export const results = [];
export async function launch() { return chromium.launch(); }
export async function ctx(b, vp = { width: 1280, height: 800 }) {
  const ls = ["ai.locale", "studio.locale"].map((name) => ({ name, value: "vi" })); const c = await b.newContext({ locale: "vi-VN", viewport: vp, storageState: { cookies: [], origins: [CHAT, ADMIN].map((origin) => ({ origin, localStorage: ls })) } }); const p = await c.newPage(); return { c, p };
}
export async function chatLogin(p, who) {
  await p.goto(`${CHAT}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("acme");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(USERS[who].u);
  await p.getByLabel("Mật khẩu").fill(USERS[who].pw);
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL(/\/c\/new$/);
}
export async function adminLogin(p, tenant, user, pw) {
  await p.goto(`${ADMIN}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(pw);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}
export const snap = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
export function mkStep(pages) {
  return async (id, title, fn) => {
    const t0 = Date.now();
    try { await fn(); results.push({ id, title, ok: true }); console.log("PASS", id, title); }
    catch (e) {
      const err = String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400);
      results.push({ id, title, ok: false, err }); console.log("FAIL", id, title, err);
      for (const [n, p] of Object.entries(pages())) await snap(p, `${id}-FAIL-${n}`).catch(() => {});
    }
  };
}
export const save = (name) => writeFileSync(`${OUT}/../${name}.json`, JSON.stringify(results, null, 1));
const AUTH = "http://localhost:3001", HUB = "http://localhost:4000";
export async function apiTok(who, tenant = "acme") {
  const r = await fetch(`${AUTH}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: tenant, username: USERS[who].u, password: USERS[who].pw }) });
  return (await r.json()).access_token;
}
export async function hub(tok, method, path, body) {
  const r = await fetch(`${HUB}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { s: r.status, j };
}
export async function uid(who) { return JSON.parse(Buffer.from((await apiTok(who)).split(".")[1], "base64url").toString()).sub; }
export async function mkRoom(owner, name, members) {
  const ids = await Promise.all(members.map(uid));
  const r = await hub(await apiTok(owner), "POST", "/rooms", { kind: "group", name, member_ids: ids });
  if (r.s !== 201) throw new Error("mkRoom " + r.s + JSON.stringify(r.j));
  return r.j.id;
}
export const roomLog = (p) => p.getByRole("log", { name: "Tin nhắn của phòng" });
