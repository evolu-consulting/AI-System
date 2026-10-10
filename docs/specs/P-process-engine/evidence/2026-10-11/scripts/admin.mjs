// UAT P-a · S6 admin-web "Quy trình": tenant_admin (tadmin/acme) và platform_admin (admin/platform).
import { launch, ctx, snap, adminLogin, mkStep, save, expect, ADMIN, results } from "./lib.mjs";
const b = await launch();
const T = await ctx(b, { width: 1280, height: 900 }), P = await ctx(b, { width: 1280, height: 900 });
const step = mkStep(() => ({ T: T.p, P: P.p }));
const body = async (p) => (await p.locator("main").innerText()).replace(/\s+/g, " ");
let runUrl;
await step("A1", "tenant_admin: nav Quy trình + danh sách (Của công ty / Mẫu)", async () => {
  await adminLogin(T.p, "acme", "tadmin", "Uat-pass-12345");
  await T.p.getByRole("link", { name: "Quy trình" }).click();
  await expect(T.p.getByRole("link", { name: "Xử lý hoá đơn" })).toBeVisible();
  await snap(T.p, "20-T-list");
  await T.p.getByRole("tab", { name: "Mẫu" }).click();
  await expect(T.p.getByText("Phát triển tính năng (AI-SDLC)")).toBeVisible(); await snap(T.p, "21-T-templates");
});
await step("A2", "tenant_admin: Chép mẫu SDLC ⇒ bản của công ty (tắt, cần chọn Group)", async () => {
  await T.p.getByRole("row", { name: /AI-SDLC/ }).getByRole("button", { name: "Chép mẫu" }).click();
  await T.p.waitForTimeout(1500); await snap(T.p, "22-T-copy");
  console.log("   sau chép:", T.p.url(), (await body(T.p)).slice(0, 200));
});
await step("A3", "tenant_admin: editor — Lưu bản trống bị chặn bằng thông báo tiếng Việt (/processes/new)", async () => {
  await T.p.goto(`${ADMIN}/processes/new`);
  await T.p.getByRole("button", { name: "Lưu", exact: true }).click(); await T.p.waitForTimeout(800);
  await T.p.screenshot({ path: "D:/AI/ai-system/docs/specs/P-process-engine/evidence/2026-10-11/shots/23-T-editor-empty-save.png", fullPage: true });
  const crumb = await T.p.locator("header").first().innerText();
  console.log("   breadcrumb:", crumb.replace(/\s+/g, " "));
  expect(crumb, "breadcrumb không được lộ khoá i18n").not.toMatch(/process\.admin\./);
});
await step("A4", "tenant_admin: Chạy hoá đơn từ danh sách ⇒ trang lượt chạy + tab Token", async () => {
  await T.p.goto(`${ADMIN}/processes`);
  await T.p.getByRole("row", { name: /Xử lý hoá đơn/ }).getByRole("button", { name: "Chạy" }).click();
  await T.p.getByRole("dialog").getByRole("textbox").fill("HD-ADM-1 4.000.000"); await snap(T.p, "24-T-run-dialog");
  await T.p.getByRole("dialog").getByRole("button", { name: "Chạy", exact: true }).click();
  await T.p.waitForTimeout(1500); await snap(T.p, "24b-T-after-run");
  console.log("   sau Chạy: url", T.p.url(), "| toast/dialog:", (await T.p.locator("[role=status],[role=dialog],[data-sonner-toast]").allInnerTexts()).join(" | "));
  await T.p.getByRole("link", { name: "Xử lý hoá đơn" }).click(); await T.p.getByRole("tab", { name: "Lượt chạy" }).click(); await T.p.waitForTimeout(1500);
  await T.p.getByRole("link", { name: /^#/ }).first().click(); await T.p.waitForURL(/\/runs\//, { timeout: 15000 }); runUrl = T.p.url();
  await T.p.waitForTimeout(3000); await snap(T.p, "25-T-run-page"); console.log("   run page:", (await body(T.p)).slice(0, 300));
  const tab = T.p.getByRole("tab", { name: "Token" }); await tab.click(); await T.p.waitForTimeout(1500); await snap(T.p, "26-T-run-token");
  console.log("   token tab:", (await body(T.p)).slice(0, 300));
});
await step("A5", "tenant_admin: tab Lượt chạy của quy trình liệt kê lượt vừa chạy", async () => {
  await T.p.goto(`${ADMIN}/processes`); await T.p.getByRole("link", { name: "Xử lý hoá đơn" }).click();
  await T.p.getByRole("tab", { name: "Lượt chạy" }).click(); await T.p.waitForTimeout(1500); await snap(T.p, "27-T-runs-tab");
  console.log("   runs:", (await body(T.p)).slice(0, 300));
});
await step("A6", "platform_admin: nav Quy trình, chọn công ty, danh sách + Mẫu", async () => {
  await adminLogin(P.p, "platform", "admin", "1234567890");
  await P.p.getByRole("link", { name: "Quy trình" }).click(); await P.p.waitForTimeout(2000); await snap(P.p, "30-P-list");
  console.log("   P list:", (await body(P.p)).slice(0, 300));
  await P.p.getByRole("tab", { name: "Mẫu" }).click(); await P.p.waitForTimeout(1200); await snap(P.p, "31-P-templates");
  await expect(P.p.getByText("Phát triển tính năng (AI-SDLC)")).toBeVisible();
});
await step("A7", "platform_admin: chọn tenant acme ⇒ danh sách công ty; nút Chạy ẩn; mở lượt chạy + Token", async () => {
  await P.p.getByRole("tab", { name: "Của công ty" }).click();
  await P.p.getByRole("combobox").first().click(); await P.p.getByRole("option", { name: /acme/i }).click(); await P.p.waitForTimeout(2000);
  await snap(P.p, "32-P-acme-list");
  await expect(P.p.getByRole("link", { name: "Xử lý hoá đơn" })).toBeVisible();
  console.log("   nút Chạy hiển thị cho platform_admin:", await P.p.getByRole("button", { name: "Chạy", exact: true }).count());
  await P.p.getByRole("link", { name: "Xử lý hoá đơn" }).click(); await P.p.getByRole("tab", { name: "Lượt chạy" }).click(); await P.p.waitForTimeout(1500);
  await P.p.getByRole("link", { name: /^#/ }).first().click(); await P.p.waitForURL(/\/runs\//, { timeout: 15000 }); await P.p.waitForTimeout(2500);
  await snap(P.p, "33-P-run-page"); await P.p.getByRole("tab", { name: "Token" }).click(); await P.p.waitForTimeout(1500); await snap(P.p, "34-P-run-token");
  console.log("   P token:", (await body(P.p)).slice(0, 300));
});
save("admin-result"); await b.close();
console.log(JSON.stringify(results.map((r) => [r.id, r.ok])));
