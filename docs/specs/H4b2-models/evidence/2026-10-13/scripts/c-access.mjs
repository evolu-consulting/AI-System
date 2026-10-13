// UAT H4b-2 phần C: Studio -> Quyền agent (ma trận agent x tenant). Chỉ ghi vào tenant evolu; khôi phục trạng thái cuối bước.
import { launch, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
import { token, api } from "./api.mjs";
const OUT = process.argv[2];
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const tok = await token();
const toast = () => page.getByRole("region", { name: "Notifications" });
const sw = (a) => page.getByRole("switch", { name: `${a} × evolu` });
const cell = async (agentKey) => {
  const m = (await api(tok, "GET", "/agent-entitlements")).body;
  const ev = m.tenants.find((t) => t.key === "evolu").id;
  const ag = m.agents.find((a) => a.key === agentKey);
  return m.cells.find((c) => c.agent_id === ag.id && c.tenant_id === ev);
};
const notToast = async (t) => { await page.waitForTimeout(300); await expect(toast()).toContainText(t); };

await studioLogin(page);
await step("C01", "Menu 'Quyền agent' → ma trận agent × tenant; lọc theo tenant evolu", async () => {
  await page.getByRole("navigation", { name: "Menu Studio" }).getByRole("link", { name: "Quyền agent" }).click();
  await expect(page.getByRole("heading", { name: "Quyền agent", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Ma trận quyền agent" })).toBeVisible();
  await expect(sw("consultant")).toBeVisible();
  await snap(page, "01-C-matrix-all", true);
  await page.getByRole("combobox", { name: "Lọc theo tenant" }).selectOption({ label: "evolu" }).catch(async () => { await page.getByRole("combobox", { name: "Lọc theo tenant" }).click(); await page.getByRole("option", { name: /evolu/i }).click(); });
  await expect(sw("consultant")).toBeVisible();
  await snap(page, "02-C-matrix-evolu", true);
});
await step("C02", "Cấp ba-analyst cho evolu (bật switch): toast, aria-checked, DB có ô", async () => {
  await expect(sw("ba-analyst")).toHaveAttribute("aria-checked", "false");
  await sw("ba-analyst").click();
  await expect(toast()).toContainText("Đã cấp ba-analyst cho evolu");
  await expect(sw("ba-analyst")).toHaveAttribute("aria-checked", "true");
  const c = await cell("ba-analyst");
  if (!c) throw new Error("ô chưa có trong API");
  await snap(page, "03-C-granted", true);
});
await step("C03", "Thu hồi ba-analyst (0 grant): hộp 'Thu hồi ba-analyst khỏi evolu?' nêu '0 grant' → xác nhận", async () => {
  await sw("ba-analyst").click();
  const d = page.getByRole("alertdialog", { name: "Thu hồi ba-analyst khỏi evolu?" });
  await expect(d).toBeVisible();
  await expect(d).toContainText("0 grant");
  await snap(page, "04-C-revoke-confirm");
  await d.getByRole("button", { name: "Thu hồi" }).click();
  await expect(toast()).toContainText("Đã thu hồi ba-analyst khỏi evolu");
  await expect(sw("ba-analyst")).toHaveAttribute("aria-checked", "false");
  await snap(page, "05-C-revoked", true);
});
await step("C04", "Thu hồi docs-architect (có grant): nêu '1 grant', Huỷ không đổi; xác nhận ⇒ mất; cấp lại ⇒ grant còn nguyên", async () => {
  const before = await cell("docs-architect");
  await sw("docs-architect").click();
  const d = page.getByRole("alertdialog", { name: "Thu hồi docs-architect khỏi evolu?" });
  await expect(d).toContainText(`${before.grant_count} grant`);
  await d.getByRole("button", { name: "Huỷ" }).click();
  await expect(sw("docs-architect")).toHaveAttribute("aria-checked", "true");
  await sw("docs-architect").click();
  await snap(page, "06-C-revoke-grants");
  await d.getByRole("button", { name: "Thu hồi" }).click();
  await expect(toast()).toContainText("Đã thu hồi docs-architect khỏi evolu");
  await expect(sw("docs-architect")).toHaveAttribute("aria-checked", "false");
  await snap(page, "07-C-revoked-grants", true);
  await sw("docs-architect").click();
  await expect(toast()).toContainText("Đã cấp docs-architect cho evolu");
  await expect(sw("docs-architect")).toHaveAttribute("aria-checked", "true");
  const after = await cell("docs-architect");
  if (after.grant_count !== before.grant_count) throw new Error(`grant mất: ${before.grant_count} -> ${after.grant_count}`);
});
await step("C05", "Thu hồi agent mặc định của evolu ⇒ 'AGENT_IS_DEFAULT' hiển thị đúng câu, switch hoàn về bật", async () => {
  // agent mặc định lấy từ cấu hình tenant: thử consultant
  await sw("consultant").click();
  const d = page.getByRole("alertdialog", { name: "Thu hồi consultant khỏi evolu?" });
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: "Thu hồi" }).click();
  await expect(toast()).toContainText("Agent đang là mặc định của tenant này. Đổi mặc định ở Admin trước khi thu hồi.");
  await expect(sw("consultant")).toHaveAttribute("aria-checked", "true");
  await snap(page, "08-C-agent-is-default", true);
  if (!(await cell("consultant"))) throw new Error("ô consultant biến mất");
});
await step("C06", "Drawer chi tiết consultant × evolu (chỉ đọc): ngày cấp, người cấp, grant trong tenant", async () => {
  await page.getByRole("button", { name: "Chi tiết consultant × evolu" }).click();
  const d = page.getByRole("dialog", { name: "Chi tiết consultant × evolu" });
  await expect(d).toContainText("Grant trong tenant");
  await snap(page, "09-C-drawer");
  await d.getByRole("button", { name: "Đóng" }).first().click();
  await expect(d).toBeHidden();
});
await step("C07", "Agent chỉ dùng cho một tenant (orchestrator riêng): ô tenant khác là '—', không có switch", async () => {
  const m = (await api(tok, "GET", "/agent-entitlements")).body;
  if (!m.agents.some((a) => a.only_tenant_id)) { console.log("C07 BỎ QUA: dev DB không có Orchestrator riêng của tenant nào (only_tenant_id) — chỉ có int/e2e mock"); return; }
  await page.getByRole("combobox", { name: "Lọc theo tenant" }).selectOption({ label: "Tất cả" }).catch(() => {});
  const dash = page.getByTitle(/^Chỉ dùng cho /).first();
  await expect(dash).toBeVisible();
  await snap(page, "10-C-only-tenant", true);
});
save();
await browser.close();
