// UAT K1 phần A: Studio -> Cài đặt -> Kết nối KnowledgeHub (thêm/kiểm/lỗi/sửa/xoá). Chạy sau h4b1-a.
import { launch, studioLogin, mkSnap, mkStep, expect, KH } from "./lib.mjs";
const OUT = process.argv[2];
const LANG = process.argv[3] ?? "vi";
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const table = () => page.getByRole("table", { name: "Kết nối KnowledgeHub" });
const row = (n) => table().getByRole("row").filter({ hasText: n });
const toast = () => page.getByRole("region", { name: "Notifications" });
const sheet = (t) => page.getByRole("dialog", { name: t });
async function openAdd() {
  await page.getByRole("button", { name: "Thêm kết nối" }).first().click();
  const d = sheet("Thêm kết nối");
  await expect(d).toBeVisible();
  return d;
}
async function pickKey(d, name) {
  await d.getByRole("combobox", { name: "Khoá" }).click();
  await page.getByRole("option", { name }).click();
}
async function fillSheet(d, { name, url, key, project }) {
  if (name !== undefined) await d.getByRole("textbox", { name: "Tên" }).fill(name);
  if (url !== undefined) await d.getByRole("textbox", { name: "Địa chỉ" }).fill(url);
  if (key) await pickKey(d, key);
  if (project !== undefined) await d.getByRole("textbox", { name: "Project ghi Tóm tắt" }).fill(project);
}
const closeSheet = async (d) => { await d.getByRole("button", { name: "Huỷ" }).click(); await expect(d).toBeHidden(); };

await studioLogin(page);
await page.goto("http://localhost:3200/studio/settings");
await expect(page.getByRole("heading", { name: "Kết nối KnowledgeHub" })).toBeVisible();
for (;;) { // dọn kết nối còn lại từ lần chạy trước (để bộ ảnh sạch)
  await page.waitForTimeout(500);
  const del = table().getByRole("button", { name: /^Xoá / }).first();
  if (!(await del.count())) break;
  await del.click(); await page.getByRole("alertdialog").getByRole("button", { name: "Xoá" }).click();
}
await step("S01", "Đăng nhập Studio → Cài đặt: tiêu đề, trạng thái rỗng, note rủi ro, chip origin được phép", async () => {
  await page.getByRole("navigation", { name: "Menu Studio" }).getByRole("link", { name: "Cài đặt" }).click();
  await expect(page.getByRole("heading", { name: "Cài đặt", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kết nối KnowledgeHub" })).toBeVisible();
  await expect(page.getByText("Chưa có kết nối KnowledgeHub").first()).toBeVisible();
  await expect(page.getByText("Agent đọc được mọi project mà khoá của kết nối thấy", { exact: false })).toBeVisible();
  const origins = page.getByRole("list", { name: "Origin được phép" });
  await expect(origins).toContainText("http://localhost:4030");
  await snap(page, "01-A-settings-empty", true);
});
await step("S02", "Thêm kết nối kh-main (URL mock, khoá kh-main, project evolu): Sheet, Lưu → toast, Sheet đóng", async () => {
  const d = await openAdd();
  await snap(page, "02-A-sheet-empty");
  await fillSheet(d, { name: "kh-main", url: KH, key: "kh-main", project: "evolu" });
  await snap(page, "03-A-sheet-filled");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(toast()).toContainText("Đã lưu kết nối kh-main");
  // Minor 1 (vòng 2): Sheet Thêm ở lại, hiện "Đã lưu · v1"
  await expect(d).toBeVisible();
  await expect(d.getByRole("status").filter({ hasText: "Đã lưu · v1" })).toBeVisible();
  await snap(page, "04-A-sheet-saved-v1");
  await d.getByRole("button", { name: "Đóng" }).click();
  await expect(d).toBeHidden();
  await expect(row("kh-main")).toContainText("Chưa kiểm tra");
  await expect(row("kh-main")).toContainText("evolu");
  await snap(page, "05-A-list-unchecked", true);
});
await step("S03", "Kiểm tra kh-main → Dialog kết quả: Kết nối đạt, phiên bản, project khoá thấy; hàng thành Đạt", async () => {
  await row("kh-main").getByRole("button", { name: "Kiểm tra kh-main" }).click();
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra" });
  await expect(dlg.getByRole("status")).toContainText("Kết nối đạt", { timeout: 30000 });
  await expect(dlg).toContainText("Phiên bản KnowledgeHub");
  await expect(dlg).toContainText("Project khoá thấy: 2");
  await snap(page, "06-A-check-ok");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(row("kh-main")).toContainText("Đạt");
  await snap(page, "07-A-list-ok", true);
});
await step("S04", "URL ngoài allowlist (https://evil.example.com) → lỗi inline 'Địa chỉ không được phép'", async () => {
  const d = await openAdd();
  await fillSheet(d, { name: "kh-evil", url: "https://evil.example.com", key: "kh-main" });
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d.getByText("Địa chỉ không được phép", { exact: false })).toBeVisible();
  await snap(page, "08-A-url-not-allowed");
  await closeSheet(d);
  await expect(row("kh-evil")).toHaveCount(0);
});
await step("S05", "Địa chỉ http không loopback (http://example.com) → lỗi client rõ", async () => {
  const d = await openAdd();
  await fillSheet(d, { name: "kh-http", url: "http://example.com", key: "kh-main" });
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d.getByText("Chỉ chấp nhận https://", { exact: false })).toBeVisible();
  await snap(page, "09-A-url-http-rejected");
  await closeSheet(d);
});
await step("S06", "Khoá sai: kết nối kh-wrongkey (127.0.0.1:4030 + khoá kh-wrong) → Kiểm tra báo KH từ chối khoá", async () => {
  const d = await openAdd();
  await fillSheet(d, { name: "kh-wrongkey", url: "http://127.0.0.1:4030", key: "kh-wrong" });
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(toast()).toContainText("Đã lưu kết nối kh-wrongkey");
  await expect(d.getByRole("status").filter({ hasText: "Đã lưu · v1" })).toBeVisible();
  await d.getByRole("button", { name: "Đóng" }).click();
  await expect(d).toBeHidden();
  await row("kh-wrongkey").getByRole("button", { name: "Kiểm tra kh-wrongkey" }).click();
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra" });
  await expect(dlg.getByRole("status")).toContainText("Kết nối chưa đạt", { timeout: 30000 });
  await expect(dlg).toContainText("KnowledgeHub từ chối khoá");
  await snap(page, "10-A-check-key-rejected");
  await page.keyboard.press("Escape");
  await expect(row("kh-wrongkey")).toContainText("Lỗi");
  await snap(page, "11-A-list-error", true);
});
await step("S07", "Sửa kh-wrongkey: đổi khoá sang kh-main → cảnh báo reset, Lưu v2, về Chưa kiểm tra → Kiểm tra Đạt", async () => {
  await row("kh-wrongkey").getByRole("button", { name: "Sửa kh-wrongkey" }).click();
  const d = sheet("Sửa kết nối");
  await expect(d).toBeVisible();
  await pickKey(d, "kh-main");
  await expect(d.getByText("Lưu sẽ đặt trạng thái về Chưa kiểm tra", { exact: false })).toBeVisible();
  await snap(page, "12-A-edit-sheet-warning");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Đã lưu · v2" })).toBeVisible();
  await d.getByRole("button", { name: "Đóng" }).click();
  await expect(row("kh-wrongkey")).toContainText("Chưa kiểm tra");
  await row("kh-wrongkey").getByRole("button", { name: "Kiểm tra kh-wrongkey" }).click();
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra" });
  await expect(dlg.getByRole("status")).toContainText("Kết nối đạt", { timeout: 30000 });
  await page.keyboard.press("Escape");
  await expect(row("kh-wrongkey")).toContainText("Đạt");
  await snap(page, "13-A-edit-rechecked", true);
});
await step("S08", "Sửa tên/project (không đổi URL/khoá) không reset trạng thái; project đổi sang shared", async () => {
  await row("kh-wrongkey").getByRole("button", { name: "Sửa kh-wrongkey" }).click();
  const d = sheet("Sửa kết nối");
  await d.getByRole("textbox", { name: "Tên" }).fill("kh-loopback");
  await d.getByRole("textbox", { name: "Project ghi Tóm tắt" }).fill("shared");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Đã lưu · v3" })).toBeVisible();
  await d.getByRole("button", { name: "Đóng" }).click();
  await expect(row("kh-loopback")).toContainText("Đạt");
  await expect(row("kh-loopback")).toContainText("shared");
  await snap(page, "14-A-edit-rename");
});
await step("S09", "Tên trùng (kh-main) khi thêm → KH_CONNECTION_EXISTS; project sai định dạng báo lỗi", async () => {
  const d = await openAdd();
  await fillSheet(d, { name: "kh-main", url: "http://localhost:4030/", key: "kh-main" });
  await d.getByRole("button", { name: "Lưu" }).click();
  await page.waitForTimeout(800);
  await snap(page, "15-A-duplicate");
  await expect(d.getByRole("status").filter({ hasText: "Đã lưu" })).toHaveCount(0);
  await d.getByRole("textbox", { name: "Project ghi Tóm tắt" }).fill("bad project!");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d.getByText("Mã project không hợp lệ")).toBeVisible();
  await snap(page, "16-A-project-invalid");
  await closeSheet(d);
});
await step("S10", "Xoá kh-loopback (chưa agent dùng): alertdialog 'Secret không bị xoá' → Xoá → biến mất", async () => {
  await row("kh-loopback").getByRole("button", { name: "Xoá kh-loopback" }).click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toContainText("Secret không bị xoá.");
  await snap(page, "17-A-delete-confirm");
  await dlg.getByRole("button", { name: "Xoá" }).click();
  await expect(row("kh-loopback")).toHaveCount(0);
  await expect(toast()).toContainText("Đã xoá kết nối kh-loopback");
  await snap(page, "18-A-delete-done", true);
});
save(); await browser.close();
