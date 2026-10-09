// Khôi phục trạng thái evolu: mặc định Orchestrator, không khớp → Evolu Consultant (qua UI platform_admin).
import { chromium, ADMIN, platformCreds, login, ensureVi } from "./lib.mjs";
const b = await chromium.launch();
const p = await (await b.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })).newPage();
const pc = platformCreds();
await login(p, ADMIN, "platform", pc.user, pc.pass, (u) => !u.pathname.startsWith("/login"));
await ensureVi(p);
await p.goto(`${ADMIN}/agents`);
await p.getByRole("combobox", { name: "Tenant" }).click();
await p.getByRole("option", { name: "evolu", exact: true }).click();
const orch = p.getByRole("row").filter({ hasText: "@orchestrator" });
await orch.waitFor();
const btn = p.getByRole("button", { name: /Đặt mặc định · Điều phối/ });
if (await btn.count()) { await btn.click(); await p.waitForTimeout(1500); }
await p.reload(); await orch.waitFor();
const cb = orch.getByRole("combobox");
if (!/Evolu Consultant/.test(await cb.innerText())) { await cb.click(); await p.getByRole("option", { name: "Evolu Consultant" }).click(); await p.waitForTimeout(1500); await p.reload(); await orch.waitFor(); }
console.log("default-in-orch:", /Mặc định/.test(await orch.innerText()), "| nomatch:", await cb.innerText());
await b.close();
