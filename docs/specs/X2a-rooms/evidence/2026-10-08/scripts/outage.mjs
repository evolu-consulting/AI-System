// Đứt thật: chặn /me/stream của Thomas + khởi động lại Hub ⇒ kết nối SSE đứt; Julian gửi lúc Thomas mất kết nối;
// mở chặn ⇒ Thomas nối lại bằng Last-Event-ID và phải nhận bù tin.
import { chromium, expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import { existsSync, writeFileSync } from "node:fs";

const OUT = process.argv[2];
const SIG = process.argv[3];
const PW = "1234567890";
const stamp = Date.now().toString(36).slice(-4);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN" });
const p = await ctx.newPage();
await p.goto("http://localhost:3100/login");
await p.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill("thomas.tran");
await p.getByLabel("Mật khẩu").fill(PW);
await p.getByRole("button", { name: "Đăng nhập" }).click();
await p.waitForURL(/\/c\/new$/);
await p.getByRole("region", { name: "Tin nhắn & Nhóm" }).getByRole("link", { name: "Julian Bui", exact: true }).click();
await p.waitForTimeout(1500);
await p.route("**/me/stream*", (r) => r.abort("internetdisconnected"));
writeFileSync(`${SIG}/ready`, "1");
console.log("READY — hãy khởi động lại Hub");
while (!existsSync(`${SIG}/go`)) await p.waitForTimeout(1000);

// Hub đã lên lại; Thomas vẫn bị chặn nối lại ⇒ banner
await p.waitForTimeout(4000);
const banner = /kết nối/i.test(await p.locator("body").innerText());
console.log("banner while disconnected:", banner);
await p.screenshot({ path: `${OUT}/14-B-disconnected-banner.png` });

const login = await fetch("http://localhost:3001/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tenant_key: "evolu", username: "julian.bui", password: PW }),
});
const tok = (await login.json()).access_token;
const rooms = await (await fetch("http://localhost:4000/rooms", { headers: { authorization: `Bearer ${tok}` } })).json();
const dm = (rooms.items ?? rooms).find((r) => r.kind === "dm" && JSON.stringify(r).includes("Thomas"));
const text = `Tin gửi khi Thomas đứt kết nối thật ${stamp}`;
const sent = await fetch(`http://localhost:4000/rooms/${dm.id}/messages`, {
  method: "POST",
  headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
  body: JSON.stringify({ content: text, client_msg_id: crypto.randomUUID() }),
});
console.log("julian send:", sent.status);
await p.waitForTimeout(3000);
const before = await p.getByRole("log", { name: "Tin nhắn của phòng" }).getByRole("article").filter({ hasText: text }).count();
console.log("visible before reconnect:", before);
await p.unroute("**/me/stream*");
await expect(p.getByRole("log", { name: "Tin nhắn của phòng" }).getByRole("article").filter({ hasText: text })).toBeVisible({ timeout: 30_000 });
await p.waitForTimeout(1500);
const bannerAfter = /kết nối lại|mất kết nối/i.test(await p.locator("body").innerText());
console.log("catch-up OK; banner after:", bannerAfter);
await p.screenshot({ path: `${OUT}/14-B-reconnected-catchup.png` });
await b.close();
