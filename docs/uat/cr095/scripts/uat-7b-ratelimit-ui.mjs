// UAT CR-095 · phan 7b: thong bao tran IP tren UI (chay ngay sau khi IP da bi 429).
import { browser, ctxFor, snap, step, ok, body, CW, AW } from "./lib.mjs";
const A = "http://127.0.0.1:13300"; // qua proxy contracts-web: cùng IP nguồn (127.0.0.1) với trình duyệt; gọi thẳng :13001 là IP khác (cổng Docker)
const login = async (u) => (await fetch(A + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_key: "acme", username: u, password: "x" }) })).status;
const b = await browser(); const c = await ctxFor(b); const p = await c.newPage();
let s = 0, n = 0; while (s !== 429 && n < 80) { s = await login("flood-" + n); n++; }
const re = /Thử đăng nhập quá nhiều lần[^\n]*/;
await step("Đăng nhập: trần theo IP → thông báo (contracts-web)", "-", async () => {
  await p.goto(CW + "/login"); await p.getByRole("textbox", { name: "Email" }).waitFor(); const tn = p.getByRole("textbox", { name: "Mã công ty" }); if (await tn.count()) await tn.fill("acme"); await p.getByRole("textbox", { name: "Email" }).fill("lan"); await p.locator("input[name=password]").fill("dev-password-1"); await p.getByRole("button", { name: "Đăng nhập" }).click(); await p.waitForTimeout(1500);
  const t = await body(p); const e = await snap(p, "40-login-ratelimit-contracts"); ok(re.test(t), "không hiện thông báo trần IP (UI tiếp tục): " + t.slice(0, 100).replace(/\n/g, " ")); return { evidence: e, note: `API chạm 429 sau ${n} lần; ${t.match(re)[0]}` }; }, p);
await step("Đăng nhập: trần theo IP → thông báo (admin-web)", "-", async () => {
  { let k = 0, st = 0; while (st !== 429 && k < 80) { st = await login("flood-y" + k); k++; } } await p.goto(AW + "/login"); await p.getByRole("textbox", { name: "Mã công ty" }).fill("acme"); await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill("lan"); await p.locator("input[name=password]").fill("dev-password-1"); await p.getByRole("button", { name: "Đăng nhập" }).click(); await p.waitForTimeout(1500);
  const t = await body(p); const e = await snap(p, "40-login-ratelimit-admin"); ok(re.test(t), "không hiện thông báo trần IP: " + t.slice(0, 100).replace(/\n/g, " ")); return { evidence: e, note: t.match(re)[0] }; }, p);
await b.close();