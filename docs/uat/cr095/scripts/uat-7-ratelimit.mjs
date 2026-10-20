// UAT CR-095 · phan 7 (CHAY CUOI): khoa tai khoan sau 5 lan sai + tran dang nhap theo IP (thong bao). Lam nghen dang nhap tu IP nay ~10 phut.
import { browser, ctxFor, snap, step, ok, settle, body, CW, AW } from "./lib.mjs";
const A = "http://127.0.0.1:13001";
const login = async (tenant, user, pw) => { const r = await fetch(A + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_key: tenant, username: user, password: pw }) }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j }; };
const b = await browser(); const c = await ctxFor(b); const p = await c.newPage();
await step("Đăng nhập: khoá tạm tài khoản sau 5 lần sai (thông báo)", "hoa", async () => {
  const codes = []; for (let i = 0; i < 5; i++) codes.push((await login("acme", "hoa", "sai-" + i)).s);
  await p.goto(CW + "/login"); await p.getByRole("textbox", { name: "Email" }).waitFor(); const tn = p.getByRole("textbox", { name: "Mã công ty" }); if (await tn.count()) await tn.fill("acme");
  await p.getByRole("textbox", { name: "Email" }).fill("hoa"); await p.locator("input[name=password]").fill("dev-password-1"); await p.getByRole("button", { name: "Đăng nhập" }).click(); await p.waitForTimeout(2000); const t = await body(p); const e = await snap(p, "40-login-locked");
  const m = t.match(/[^\n]*(khoá|khóa|tạm|phút)[^\n]*/i); ok(m, "không có thông báo khoá/chờ: " + t.slice(0, 150).replace(/\n/g, " ")); return { evidence: e, note: `5 lần sai → mã ${codes.join(",")}; UI: ${m[0]}` }; }, p);
await step("Đăng nhập: trần theo IP → thông báo 'Thử đăng nhập quá nhiều lần' (contracts-web + admin-web)", "-", async () => {
  let n = 0, hit = null; for (; n < 60; n++) { const r = await login("acme", "khong-co-" + n, "x"); if (r.s === 429) { hit = r; break; } }
  ok(hit, "60 lần liên tiếp không chạm trần IP (mặc định 30/10 phút)");
  await p.goto(CW + "/login"); await p.getByRole("textbox", { name: "Email" }).waitFor(); const tn = p.getByRole("textbox", { name: "Mã công ty" }); if (await tn.count()) await tn.fill("acme"); await p.getByRole("textbox", { name: "Email" }).fill("lan"); await p.locator("input[name=password]").fill("dev-password-1"); await p.getByRole("button", { name: "Đăng nhập" }).click(); await p.waitForTimeout(2000); const t1 = await body(p); const e1 = await snap(p, "40-login-ratelimit-contracts");
  await p.goto(AW + "/login"); await p.getByRole("textbox", { name: "Mã công ty" }).fill("acme"); await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill("lan"); await p.locator("input[name=password]").fill("dev-password-1"); await p.getByRole("button", { name: "Đăng nhập" }).click(); await p.waitForTimeout(2000); const t2 = await body(p); const e2 = await snap(p, "40-login-ratelimit-admin");
  const re = /Thử đăng nhập quá nhiều lần[^\n]*/; ok(re.test(t1), "contracts-web không hiện thông báo trần IP: " + t1.slice(0, 120).replace(/\n/g, " ")); ok(re.test(t2), "admin-web không hiện thông báo trần IP");
  return { evidence: e1 + ", " + e2, note: `chạm trần sau ${n + 1} lần; mã ${hit.s}; ${t1.match(re)[0]}; admin: ${t2.match(re)[0]}` }; }, p);
await b.close();