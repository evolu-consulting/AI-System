// CR-186 (viết, CHƯA chạy) · bình luận lưu người được nhắc: sau khi gửi (và tải lại danh sách) bình luận hiện «Nhắc: …» + «@Tên» tô đậm,
// giống bài đăng; bình luận cũ không nhắc ai thì không có dòng «Nhắc». Adapter mock (chủ quản).
import { expect, test } from "@playwright/test";

test("bình luận có người được nhắc hiện dòng «Nhắc: …» và «@Tên» tô đậm, bình luận cũ không có dòng này", async ({
  page,
}) => {
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  await expect(card.getByTestId("comment-mentions")).toHaveCount(0); // bình luận cũ của seed
  await card.getByRole("combobox", { name: "Viết bình luận" }).pressSequentially("@"); // CR-193: không còn nút «Nhắc tên», chỉ gõ @
  const dlg = page.getByTestId("mention-dialog");
  await dlg.getByTestId("mention-option").filter({ hasText: "Lan" }).getByRole("checkbox").check();
  await dlg.getByRole("button", { name: "Xong (1 người)" }).click();
  await card.getByRole("button", { name: "Gửi bình luận" }).click();
  const mine = card.getByTestId("comment").filter({ hasText: "@Lan" });
  await expect(mine.getByTestId("comment-mentions")).toContainText("Nhắc: Lan");
  await expect(mine.getByTestId("mention-tag")).toContainText("@Lan");
});
