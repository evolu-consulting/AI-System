// CR-186 (viết, CHƯA chạy) · «@» trong ô BÌNH LUẬN mở CHUNG hộp «Nhắc tên» (lọc nhóm + tìm tên) như ô đăng bài; gửi kèm người được nhắc.
// Adapter mock (persona mặc định = chủ quản).
import { expect, test } from "@playwright/test";

test("gõ «@» ở ô bình luận ⇒ danh sách thả tại chỗ (avatar, tên, chức vụ · công ty), gõ tên lọc, chọn ⇒ «@Tên» vào chữ, gửi ⇒ bình luận hiện «@Tên»", async ({
  page,
}) => {
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  const box = card.getByRole("combobox", { name: "Viết bình luận" });
  await box.fill("Nhờ ");
  await box.pressSequentially("@");
  const list = card.getByTestId("mention-suggest");
  await expect(list).toBeVisible();
  await expect(page.getByTestId("mention-dialog")).toHaveCount(0); // CR-193: không hộp thoại, không ô tích
  await box.pressSequentially("Lan");
  await expect(list.getByTestId("mention-option")).toHaveCount(1);
  await list.getByTestId("mention-option").first().click();
  await expect(box).toHaveValue(/Nhờ @Lan/);
  await expect(list).toHaveCount(0);
  await card.getByRole("button", { name: "Gửi bình luận" }).click();
  await expect(card.getByText(/@Lan/)).toBeVisible();
});

test("«@» ở ô bình luận: Esc đóng danh sách; gõ tên + Enter chọn người", async ({ page }) => {
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  const box = card.getByRole("combobox", { name: "Viết bình luận" });
  await box.fill("");
  await box.pressSequentially("@");
  await expect(card.getByTestId("mention-suggest")).toBeVisible();
  await box.press("Escape");
  await expect(card.getByTestId("mention-suggest")).toHaveCount(0);
  await box.pressSequentially("Trần");
  await expect(card.getByTestId("mention-option").first()).toContainText("Trần B");
  await box.press("Enter");
  await expect(box).toHaveValue(/@Trần B/);
});
