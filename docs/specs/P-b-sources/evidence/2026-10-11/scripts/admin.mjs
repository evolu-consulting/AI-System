import { launch, ctx, step, shot, adminLogin, ADMIN, save, OUT } from "./h.mjs";
import { expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";
const b = await launch();
const nav = (p) => p.getByRole("link", { name: /^(Nguồn|Sources)$/ });
const rowOf = (p, k) => p.getByRole("table").getByRole("row").filter({ hasText: k });
// ---- 1. platform_admin
{
  const c = await ctx(b, ADMIN); const p = await c.newPage(); const apiBodies = [];
  p.on("response", async (r) => { if (r.url().includes("/admin/sources") && r.request().method() === "GET") { try { apiBodies.push(await r.text()); } catch {} } });
  await step("S1a", "platform_admin đăng nhập, mở trang Nguồn thấy ai-system-repo", p, async () => {
    await adminLogin(p, "platform", "admin");
    await shot(p, "01-A-platform-home");
    await nav(p).click();
    await expect(p.getByRole("heading", { name: "Nguồn tham chiếu" })).toBeVisible();
    await p.getByRole("combobox", { name: /Chọn công ty/ }).click().catch(()=>{}); await p.getByText("Chọn công ty").first().click().catch(()=>{});
    await p.getByRole("option", { name: /evolu/i }).first().click();
    await p.waitForTimeout(800);
    await expect(rowOf(p, "ai-system-repo")).toBeVisible();
    await shot(p, "02-A-platform-sources-list");
  });
  await step("S1b", "platform_admin mở nguồn: thấy path /mnt/d/AI/ai-system", p, async () => {
    await rowOf(p, "ai-system-repo").getByRole("button", { name: /ai-system-repo/ }).click();
    await shot(p, "03-A-platform-row-menu");
    const items = await p.getByRole("menuitem").allInnerTexts(); fs.writeFileSync(OUT + "/menu-platform.txt", items.join("\n"));
    const first = p.getByRole("menuitem").first(); await first.click();
    await p.waitForTimeout(1200);
    await shot(p, "04-A-platform-source-detail");
    await expect(p.getByText("/mnt/d/AI/ai-system").first()).toBeVisible();
  });
  fs.writeFileSync(OUT + "/api-platform-sources.json", apiBodies.join("\n"));
  await c.close();
}
// ---- 2. tenant_admin evolu
{
  const c = await ctx(b, ADMIN); const p = await c.newPage(); const apiBodies = [];
  p.on("response", async (r) => { if (r.url().includes("/admin/sources")) { try { apiBodies.push(r.request().method() + " " + r.url() + " " + r.status() + "\n" + await r.text()); } catch {} } });
  await step("S2a", "tenant_admin evolu: trang Nguồn thấy dòng nhưng KHÔNG thấy path", p, async () => {
    await adminLogin(p, "evolu", "julian.bui");
    await nav(p).click();
    await expect(rowOf(p, "ai-system-repo")).toBeVisible();
    await shot(p, "05-B-tenantadmin-sources-list");
    const text = await p.locator("body").innerText();
    if (text.includes("/mnt/d") || text.includes("AI/ai-system")) throw new Error("UI lộ path");
  });
  await step("S2b", "tenant_admin evolu: mở nguồn/menu — không có Sửa/Xoá, không lộ path", p, async () => {
    await rowOf(p, "ai-system-repo").getByRole("button", { name: /ai-system-repo/ }).click().catch(() => {});
    await shot(p, "06-B-tenantadmin-row-menu");
    const items = await p.getByRole("menuitem").allInnerTexts(); fs.writeFileSync(OUT + "/menu-tenantadmin.txt", items.join("\n"));
    if (items.some((t) => /Sửa|Xoá/.test(t))) throw new Error("menu có Sửa/Xoá: " + items.join("|"));
    const first = p.getByRole("menuitem").first(); if (await first.count()) await first.click();
    await p.waitForTimeout(1200);
    await shot(p, "07-B-tenantadmin-source-detail");
    const text = await p.locator("body").innerText();
    if (text.includes("/mnt/d") || text.includes("AI/ai-system")) throw new Error("UI lộ path");
  });
  fs.writeFileSync(OUT + "/api-tenantadmin-sources.txt", apiBodies.join("\n\n"));
  const leak = apiBodies.join("").includes("/mnt/d");
  await step("S2c", "API GET /admin/sources cho tenant_admin không chứa path", p, async () => { if (leak) throw new Error("API lộ path"); });
  await c.close();
}
await b.close(); save();
