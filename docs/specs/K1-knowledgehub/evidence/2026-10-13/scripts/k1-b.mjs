// UAT K1 phần B: Sửa agent tick/bỏ tick KH; xoá kết nối/secret đang dùng bị chặn. Ảnh secret ghi vào thư mục H4b-1.
import { launch, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
const OUT = process.argv[2];
const OUT_H = process.argv[3];
const AG = {
  "intake-analyst": "c5cfdb36-6e4b-4d87-b612-542b132fbea5",
  "docs-architect": "48cf7e46-e21e-46f8-baa5-90f5fe22ed4c",
  "backend-lead": "81320bc4-2ac1-47e9-98b5-36b6db862e32",
  chatbot: "2aebe09f-75d7-437b-bb89-ba0d005051b4",
};
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const snapH = mkSnap(OUT_H);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const toast = () => page.getByRole("region", { name: "Notifications" });
const region = () => page.getByRole("region", { name: "KnowledgeHub" });
const gotoAgent = async (k) => { await page.goto(`http://localhost:3200/studio/agents/${AG[k]}`); await expect(region()).toBeVisible({ timeout: 15000 }); await expect(region().getByRole("checkbox", { name: "kh-main" })).toBeVisible(); };

await studioLogin(page);
await step("A01", "Sửa agent intake-analyst: section KnowledgeHub hiện kết nối kh-main (địa chỉ, badge Đạt), chưa tick", async () => {
  await gotoAgent("intake-analyst");
  await expect(region().getByRole("checkbox", { name: "kh-main" })).not.toBeChecked();
  await expect(region()).toContainText("http://localhost:4030");
  await expect(region()).toContainText("Đạt");
  await snap(page, "20-B-agent-knowledge-unticked");
});
await step("A02", "Tick kh-main → Lưu → toast 'Đã lưu kết nối của agent'; tải lại vẫn tick", async () => {
  await region().getByRole("checkbox", { name: "kh-main" }).check();
  await snap(page, "21-B-agent-ticked");
  await region().getByRole("button", { name: "Lưu" }).click();
  await expect(toast()).toContainText("Đã lưu kết nối của agent");
  await snap(page, "22-B-agent-saved");
  await page.reload();
  await expect(region().getByRole("checkbox", { name: "kh-main" })).toBeChecked();
});
await step("A03", "Bỏ tick → Lưu → tải lại không tick; Agent dùng ở Cài đặt về 0; rồi tick lại và lưu", async () => {
  await region().getByRole("checkbox", { name: "kh-main" }).uncheck();
  await region().getByRole("button", { name: "Lưu" }).click();
  await expect(toast()).toContainText("Đã lưu kết nối của agent");
  await snap(page, "23-B-agent-unticked-saved");
  await page.reload();
  await expect(region().getByRole("checkbox", { name: "kh-main" })).not.toBeChecked();
  await region().getByRole("checkbox", { name: "kh-main" }).check();
  await region().getByRole("button", { name: "Lưu" }).click();
  await expect(toast()).toContainText("Đã lưu kết nối của agent");
});
await step("A04", "Tick tiếp docs-architect và backend-lead (các agent chạy stage sdlc-delivery)", async () => {
  for (const k of ["docs-architect", "backend-lead"]) {
    await gotoAgent(k);
    await region().getByRole("checkbox", { name: "kh-main" }).check();
    await region().getByRole("button", { name: "Lưu" }).click();
    await expect(toast()).toContainText("Đã lưu kết nối của agent");
    await page.reload();
    await expect(region().getByRole("checkbox", { name: "kh-main" })).toBeChecked();
  }
  await snap(page, "24-B-agent-backend-lead");
});
await step("A05", "Agent không phải CLI (Chatbot Dify): section báo 'Chỉ agent chạy bằng CLI…'", async () => {
  await page.goto(`http://localhost:3200/studio/agents/${AG.chatbot}`);
  await page.waitForTimeout(2000);
  await expect(page.getByText("Chỉ agent chạy bằng CLI mới dùng được tri thức").first()).toBeVisible();
  await snap(page, "25-B-agent-non-cli");
});
await step("A06", "Cài đặt: kh-main 'Agent dùng' = 3; Xoá kết nối đang dùng bị chặn (alert 'agent đang dùng')", async () => {
  await page.goto("http://localhost:3200/studio/settings");
  const row = page.getByRole("table", { name: "Kết nối KnowledgeHub" }).getByRole("row").filter({ hasText: "kh-main" });
  await expect(row).toContainText("3");
  await snap(page, "26-B-settings-agents-count");
  await row.getByRole("button", { name: "Xoá kh-main" }).click();
  const dlg = page.getByRole("alertdialog");
  await dlg.getByRole("button", { name: "Xoá" }).click();
  await expect(dlg.getByRole("alert")).toContainText("agent đang dùng");
  await snap(page, "27-B-delete-in-use-blocked");
  await dlg.getByRole("button", { name: "Huỷ" }).click();
  await expect(row).toBeVisible();
});
await step("H01", "[H4b-1] Xoá secret kh-main đang được kết nối dùng → chặn, danh sách nơi dùng (knowledge_hub · kh-main)", async () => {
  await page.goto("http://localhost:3200/studio/secrets");
  await page.getByRole("tablist", { name: "Loại secret" }).getByRole("tab", { name: "Khoá KnowledgeHub" }).click();
  const row = page.getByRole("table", { name: "Danh sách secret" }).getByRole("row").filter({ hasText: "kh-main" });
  await expect(row).toContainText("kh-main");
  await snapH(page, "20-A-kh-in-use-badge");
  await row.getByRole("button", { name: "Xoá" }).click();
  await page.getByRole("alertdialog", { name: "Xoá kh-main?" }).getByRole("button", { name: "Xoá" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Không xoá được kh-main" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("kh-main");
  await snapH(page, "21-A-kh-delete-blocked");
  await dlg.getByRole("button", { name: "Đóng" }).click();
  await expect(row).toBeVisible();
});
save(); await browser.close();
