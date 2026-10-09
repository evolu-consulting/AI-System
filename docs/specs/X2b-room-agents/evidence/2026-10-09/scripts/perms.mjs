// Đổi quyền agent qua UI Admin (julian.bui, tenant_admin): node perms.mjs <revoke|restore> <agentKey> <Tên người> <outDir>
import { chromium, ADMIN, PW, login, ensureVi } from "./lib.mjs";
const [op, key, who, OUT] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })).newPage();
await login(p, ADMIN, "evolu", "julian.bui", PW, (u) => !u.pathname.startsWith("/login"));
await ensureVi(p); await p.goto(`${ADMIN}/agents`);
const r = p.getByRole("row").filter({ hasText: `@${key}` }); await r.waitFor();
await r.getByRole("button", { name: /^Cấp quyền/ }).click();
const d = p.getByRole("dialog");
const cb = d.getByRole("checkbox", { name: new RegExp(who) });
await cb.waitFor();
if (op === "revoke") await cb.uncheck(); else await cb.check();
console.log(await d.getByText(/^Kết quả/).innerText());
await p.screenshot({ path: `${OUT}/perm-${op}-${key}-${who.replace(/\W/g, "")}.png` });
await d.getByRole("button", { name: "Lưu" }).click();
await p.waitForTimeout(2000);
// kiểm lại
await p.reload(); const r2 = p.getByRole("row").filter({ hasText: `@${key}` }); await r2.waitFor();
console.log("hàng sau lưu:", (await r2.innerText()).replace(/\s+/g, " ").slice(-120));
await b.close();
