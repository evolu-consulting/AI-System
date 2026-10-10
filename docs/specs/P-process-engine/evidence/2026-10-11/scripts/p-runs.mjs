// Xác minh: platform_admin (tenant acme) tab Lượt chạy có rỗng dù cột "Lượt đang chạy" > 0?
import { launch, ctx, snap, adminLogin, ADMIN } from "./lib.mjs";
const b = await launch(); const { p } = await ctx(b, { width: 1280, height: 800 });
p.on("response", async (r) => { const u = new URL(r.url()); if (u.port === "4000" && u.pathname.startsWith("/process")) console.log("HUB", r.status(), u.pathname + u.search); });
await adminLogin(p, "platform", "admin", "1234567890");
await p.goto(`${ADMIN}/processes`); await p.getByRole("combobox").first().click(); await p.getByRole("option", { name: /acme/i }).click(); await p.waitForTimeout(2000);
await p.getByRole("link", { name: "Xử lý hoá đơn" }).click(); await p.getByRole("tab", { name: "Lượt chạy" }).click(); await p.waitForTimeout(5000);
await snap(p, "35-P-runs-tab-5s"); console.log((await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200));
await b.close();
