// Luồng 16 · popup hết lượt tải HĐ (upload-quota-popup) trên bản build thật. POST tải lên bị chặn NGAY trong trình duyệt (route giả 429
// UPLOAD_QUOTA) ⇒ không gọi máy chủ, không tốn lượt thật, không tạo dữ liệu. Chỉ tenant demo (DEMO_USER, mật khẩu DEMO_PW).
import { CW, expect, login, settle, TAG, test } from "./_support";

test("[popup hết lượt] 429 UPLOAD_QUOTA ⇒ popup một lần, dừng hàng đợi, không có Thử lại", async ({
  page,
}) => {
  await login(page, CW);
  let posts = 0;
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      posts++;
      return r.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "UPLOAD_QUOTA",
            message: "Upload quota exceeded",
            details: { scope: "tenant", limit: 30, resets_at: "2026-10-28T17:00:00Z" },
          },
        }),
      });
    },
  );
  await page.goto(`${CW}/contracts`);
  await settle(page);
  await page.locator('input[type="file"]').setInputFiles([
    { name: `${TAG}-a.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 a") },
    { name: `${TAG}-b.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 b") },
  ]);
  const dialog = page.getByRole("dialog", { name: "Đã hết lượt tải hợp đồng hôm nay" });
  await expect(dialog).toContainText("Công ty đã dùng hết 30 lượt tải lên trong ngày");
  await dialog.getByRole("button", { name: "Đã hiểu" }).click();
  await expect(dialog).toBeHidden();
  const panel = page.getByRole("region", { name: "Tải lên hợp đồng" });
  await expect(panel.locator('li[data-state="error"]')).toHaveCount(2);
  await expect(panel.getByRole("button", { name: "Thử lại" })).toHaveCount(0);
  expect(posts).toBe(1);
});
