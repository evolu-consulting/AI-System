// UAT H4b-2 phần A: Studio -> Models -> Providers (CRUD, kiểm tra key, Runbook). Cấu hình toàn nền tảng.
import { launch, studioLogin, mkSnap, mkStep, expect } from "./lib.mjs";
import { sql } from "./sql.mjs";
const OUT = process.argv[2];
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A: page }), snap);
const table = () => page.getByRole("table", { name: "Danh sách provider" });
const row = (k) => table().getByRole("row").filter({ hasText: k }).first();
const toast = () => page.getByRole("region", { name: "Notifications" });
const choose = async (box, label) => {
  const tag = await box.evaluate((e) => e.tagName.toLowerCase());
  if (tag === "select") return box.selectOption({ label });
  await box.click();
  await page.getByRole("option", { name: label, exact: true }).click();
};
const openSheet = () => page.getByRole("button", { name: "+ Thêm provider" }).click();
const setEnabled = async (d, on) => {
  const c = d.getByRole("checkbox", { name: "Bật provider" });
  if (await c.count()) return on ? c.check() : c.uncheck();
  const s = d.getByRole("switch", { name: "Bật provider" });
  if ((await s.getAttribute("aria-checked")) !== String(on)) await s.click();
};

sql("delete from hub.provider_state where provider_key like 'uat-%'");
await studioLogin(page);
await page.goto("http://localhost:3200/studio/models");
await expect(table()).toBeVisible();
for (;;) { // dọn dữ liệu còn lại từ lần chạy trước
  await page.waitForTimeout(400);
  const r = table().getByRole("row").filter({ hasText: /uat-/ }).first();
  if (!(await r.count())) break;
  await r.getByRole("button", { name: "Xoá" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Xoá" }).click();
}

await step("A01", "Menu Models → danh sách provider (tiêu đề, tab, cột, nút theo loại)", async () => {
  await page.getByRole("navigation", { name: "Menu Studio" }).getByRole("link", { name: "Models" }).click();
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Models" }).getByRole("tab", { name: "Providers" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Đơn giá" })).toHaveCount(0);
  await expect(row("claude-sub").getByRole("button", { name: "Kiểm tra lại" })).toBeVisible();
  await expect(row("dify").getByRole("button", { name: "Kiểm tra key" })).toBeVisible();
  await expect(row("fake-cli")).toContainText("dev");
  await snap(page, "01-A-providers-list", true);
});
await step("A02", "Xem chi tiết (Sửa) claude-sub: Loại chỉ đọc, không ô API key, slot = 2", async () => {
  await row("claude-sub").getByRole("button", { name: "Sửa" }).click();
  const d = page.getByRole("dialog", { name: "Sửa provider · claude-sub" });
  await expect(d).toContainText("không đổi được sau khi tạo");
  await expect(d.getByRole("combobox", { name: "API key" })).toHaveCount(0);
  await expect(d.getByRole("spinbutton", { name: "Số slot tối đa" })).toHaveValue("2");
  await snap(page, "02-A-detail-claude-sub");
  await d.getByRole("button", { name: "Huỷ" }).click();
  await expect(d).toBeHidden();
});
await step("A03", "Sheet Thêm provider: validate (khoá sai, thiếu API key) không gửi", async () => {
  await openSheet();
  const d = page.getByRole("dialog", { name: "Thêm provider" });
  await d.getByRole("textbox", { name: "Khoá provider" }).fill("A");
  await choose(d.getByRole("combobox", { name: "Loại" }), "API");
  await choose(d.getByRole("combobox", { name: "Hãng" }), "Fake (dev)");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d).toContainText("Bắt đầu bằng chữ thường");
  await expect(d).toContainText("Chọn API key");
  await expect(d.locator('input[type="password"]')).toHaveCount(0);
  await snap(page, "03-A-sheet-validate");
  await d.getByRole("button", { name: "Huỷ" }).click();
});
await step("A04", "Tạo provider API vendor fake uat-fake-api (secret uat-fake-ok): toast + dòng + 'dev'", async () => {
  await openSheet();
  const d = page.getByRole("dialog", { name: "Thêm provider" });
  await d.getByRole("textbox", { name: "Khoá provider" }).fill("uat-fake-api");
  await choose(d.getByRole("combobox", { name: "Loại" }), "API");
  await choose(d.getByRole("combobox", { name: "Hãng" }), "Fake (dev)");
  await choose(d.getByRole("combobox", { name: "API key" }), "uat-fake-ok");
  await snap(page, "04-A-sheet-filled");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(toast()).toContainText("Đã lưu uat-fake-api");
  await expect(d).toBeHidden();
  await expect(row("uat-fake-api")).toContainText("dev");
  await snap(page, "05-A-created", true);
});
await step("A05", "Khoá trùng ⇒ 'Khoá này đã được dùng'", async () => {
  await openSheet();
  const d = page.getByRole("dialog", { name: "Thêm provider" });
  await d.getByRole("textbox", { name: "Khoá provider" }).fill("uat-fake-api");
  await choose(d.getByRole("combobox", { name: "Loại" }), "Subscription");
  await choose(d.getByRole("combobox", { name: "Hãng" }), "Fake (dev)");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d).toContainText("Khoá này đã được dùng");
  await snap(page, "06-A-key-taken");
  await d.getByRole("button", { name: "Huỷ" }).click();
});
await step("A06", "Kiểm tra key hợp lệ (fake-ok…): 'Key hợp lệ'", async () => {
  await row("uat-fake-api").getByRole("button", { name: "Kiểm tra key" }).click();
  const d = page.getByRole("dialog", { name: "Kết quả kiểm tra · uat-fake-api" });
  await expect(d.getByRole("status")).toContainText("Key hợp lệ");
  await snap(page, "07-A-check-ok");
  await d.getByRole("button", { name: "Đóng" }).click();
  await expect(d).toBeHidden();
});
await step("A07", "Tạo uat-fake-bad (secret uat-fake-bad) → Kiểm tra: 'Key không hợp lệ' + Chi tiết; Kiểm tra lại", async () => {
  await openSheet();
  const d = page.getByRole("dialog", { name: "Thêm provider" });
  await d.getByRole("textbox", { name: "Khoá provider" }).fill("uat-fake-bad");
  await choose(d.getByRole("combobox", { name: "Loại" }), "API");
  await choose(d.getByRole("combobox", { name: "Hãng" }), "Fake (dev)");
  await choose(d.getByRole("combobox", { name: "API key" }), "uat-fake-bad");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d).toBeHidden();
  await row("uat-fake-bad").getByRole("button", { name: "Kiểm tra key" }).click();
  const c = page.getByRole("dialog", { name: "Kết quả kiểm tra · uat-fake-bad" });
  await expect(c.getByRole("status")).toContainText("Key không hợp lệ");
  await expect(c.getByRole("group", { name: "Chi tiết" })).toContainText(/401|invalid/i);
  await snap(page, "08-A-check-bad");
  await c.getByRole("button", { name: "Kiểm tra lại" }).click();
  await expect(c.getByRole("status")).toContainText("Key không hợp lệ");
  await snap(page, "09-A-check-bad-again");
  await c.getByRole("button", { name: "Đóng" }).click();
});
await step("A08", "Tạo subscription uat-sub: 'Chưa có Worker kiểm'; Kiểm tra lại ⇒ 'đã yêu cầu' (không Worker)", async () => {
  await openSheet();
  const d = page.getByRole("dialog", { name: "Thêm provider" });
  await d.getByRole("textbox", { name: "Khoá provider" }).fill("uat-sub");
  await choose(d.getByRole("combobox", { name: "Loại" }), "Subscription");
  await choose(d.getByRole("combobox", { name: "Hãng" }), "OpenAI");
  await expect(d).toContainText("Khoá phải trùng provider đã cài ở Worker");
  await snap(page, "10-A-sheet-subscription");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d).toBeHidden();
  await expect(row("uat-sub")).toContainText("Chưa có Worker kiểm");
  await row("uat-sub").getByRole("button", { name: "Kiểm tra lại" }).click();
  const c = page.getByRole("dialog", { name: "Kết quả kiểm tra · uat-sub" });
  await expect(c.getByRole("status")).toContainText(/Đã yêu cầu kiểm tra|Worker chưa kiểm xong/, { timeout: 20000 });
  await snap(page, "11-A-check-sub-requested");
  await c.getByRole("button", { name: "Đóng" }).click();
});
await step("A09", "Subscription có Runtime thật: Kiểm tra lại fake-cli → kết quả", async () => {
  await row("fake-cli").getByRole("button", { name: "Kiểm tra lại" }).click();
  const c = page.getByRole("dialog", { name: "Kết quả kiểm tra · fake-cli" });
  await expect(c.getByRole("status")).not.toContainText("Đang kiểm tra", { timeout: 20000 });
  await snap(page, "12-A-check-fake-cli");
  console.log("fake-cli:", await c.getByRole("status").innerText());
  await c.getByRole("button", { name: "Đóng" }).click();
});
await step("A10", "Runbook: uat-sub logged_out ⇒ 'Hướng dẫn' → sheet, Sao chép, Kiểm tra lại", async () => {
  sql("insert into hub.provider_state(provider_key,status,last_error) values ('uat-sub','logged_out','Not logged in') on conflict (provider_key) do update set status='logged_out', last_error='Not logged in'");
  await page.reload();
  await expect(table()).toBeVisible();
  await expect(row("uat-sub")).toContainText("hết phiên");
  await snap(page, "13-A-logged-out-row", true);
  await row("uat-sub").getByRole("button", { name: "Hướng dẫn" }).click();
  const d = page.getByRole("dialog", { name: "Đăng nhập CLI · uat-sub" });
  await expect(d).toBeVisible();
  await expect(d).toContainText("codex login");
  await d.getByRole("button", { name: "Sao chép lệnh bước 2" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Đã sao chép" })).toBeVisible();
  await snap(page, "14-A-runbook");
  await d.getByRole("button", { name: "Kiểm tra lại" }).click();
  const c = page.getByRole("dialog", { name: "Kết quả kiểm tra · uat-sub" });
  await expect(c).toBeVisible();
  await snap(page, "15-A-runbook-recheck");
  await expect(c.getByRole("button", { name: "Đóng" })).toBeEnabled({ timeout: 20000 });
  await c.getByRole("button", { name: "Đóng" }).click();
});
await step("A11", "Sửa uat-fake-api: tắt 'Bật provider' → Lưu", async () => {
  await row("uat-fake-api").getByRole("button", { name: "Sửa" }).click();
  const d = page.getByRole("dialog", { name: "Sửa provider · uat-fake-api" });
  await expect(d.getByRole("combobox", { name: "API key" })).toContainText("uat-fake-ok");
  await expect(d.getByRole("spinbutton", { name: "Số slot tối đa" })).toHaveCount(0); // loại api: không có ô slot (plan-frontend D5)
  await setEnabled(d, false);
  await snap(page, "16-A-edit-disable");
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(toast()).toContainText("Đã lưu uat-fake-api");
  await snap(page, "17-A-disabled-row", true);
});
await step("A12", "Bật lại uat-fake-api", async () => {
  await row("uat-fake-api").getByRole("button", { name: "Sửa" }).click();
  const d = page.getByRole("dialog", { name: "Sửa provider · uat-fake-api" });
  await setEnabled(d, true);
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d).toBeHidden();
});
await step("A13", "Provider hệ thống dify (readonly): Xoá bị chặn bằng câu rõ ràng", async () => {
  await row("dify").getByRole("button", { name: "Xoá" }).click();
  const c = page.getByRole("alertdialog", { name: "Xoá dify?" });
  if (await c.isVisible().catch(() => false)) { await snap(page, "18-A-dify-delete-confirm"); await c.getByRole("button", { name: "Xoá" }).click(); }
  await page.waitForTimeout(800);
  await snap(page, "19-A-dify-delete-result");
  await expect(page.getByText("Provider này do hệ thống quản lý, không sửa được").first()).toBeVisible();
});
await step("A14", "Xoá uat-fake-bad (rảnh): hộp xác nhận → toast → dòng biến mất", async () => {
  await row("uat-fake-bad").getByRole("button", { name: "Xoá" }).click();
  const c = page.getByRole("alertdialog", { name: "Xoá uat-fake-bad?" });
  await expect(c).toBeVisible();
  await snap(page, "20-A-delete-confirm");
  await c.getByRole("button", { name: "Xoá" }).click();
  await expect(toast()).toContainText("Đã xoá uat-fake-bad");
  await expect(table().getByRole("row").filter({ hasText: "uat-fake-bad" })).toHaveCount(0);
  await snap(page, "21-A-deleted", true);
});
save();
await browser.close();
