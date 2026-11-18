// CR-186 (viết, CHƯA chạy) · «@» trong ô BÌNH LUẬN mở CHUNG hộp «Nhắc tên» (lọc nhóm + tìm tên) như ô đăng bài; gửi kèm người được nhắc.
// Adapter mock (persona mặc định = chủ quản).
import { expect, test } from "@playwright/test";

test("gõ «@» ở ô bình luận ⇒ hộp «Nhắc tên» có lọc nhóm + tìm, chọn người ⇒ «@Tên» vào chữ, gửi ⇒ bình luận hiện «@Tên»", async ({
  page,
}) => {
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  const box = card.getByRole("combobox", { name: "Viết bình luận" });
  await box.fill("Nhờ ");
  await box.pressSequentially("@");
  const dlg = page.getByTestId("mention-dialog");
  await expect(dlg).toBeVisible();
  // hộp là hộp thoại modal ⇒ nền bị aria-hidden: tìm ô theo includeHidden
  const hidden = card.getByRole("combobox", { name: "Viết bình luận", includeHidden: true });
  await expect(hidden).toHaveValue("Nhờ "); // dấu «@» vừa gõ không nằm lại trong chữ
  await expect(dlg.getByRole("combobox", { name: "Nhóm người" })).toContainText("Tất cả");
  await expect(dlg.getByRole("searchbox", { name: "Tìm theo tên" })).toBeVisible();
  await dlg.getByRole("searchbox", { name: "Tìm theo tên" }).fill("Lan");
  await expect(dlg.getByTestId("mention-option")).toHaveCount(1);
  await dlg.getByTestId("mention-option").first().getByRole("checkbox").check();
  await dlg.getByRole("button", { name: "Xong (1 người)" }).click();
  await expect(box).toHaveValue(/@Lan/);
  await card.getByRole("button", { name: "Gửi bình luận" }).click();
  await expect(card.getByText(/@Lan/)).toBeVisible();
});

test("nút «Nhắc tên» cạnh ô bình luận mở cùng hộp; lọc «Khách hàng» chỉ còn người công ty khách hàng", async ({
  page,
}) => {
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  await card.getByRole("button", { name: "Nhắc tên" }).click();
  const dlg = page.getByTestId("mention-dialog");
  await dlg.getByRole("combobox", { name: "Nhóm người" }).click();
  await page.getByRole("option", { name: "Khách hàng", exact: true }).click();
  await expect(dlg.getByTestId("mention-option")).toHaveCount(1);
  await expect(dlg.getByTestId("mention-option").first()).toContainText("Trần B");
});
