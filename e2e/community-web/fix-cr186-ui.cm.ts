// fix-cr186-ui (viết, CHƯA chạy) · mở Bảng tin lần đầu: bài có bình luận hiện SẴN 3 bình luận mới nhất (không phải bấm «Bình luận»). Adapter mock.
import { expect, test } from "@playwright/test";

test("bài p1 (3 bình luận) hiện sẵn cả 3, nút «Bình luận» đang mở; bấm thì gập", async ({
  page,
}) => {
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  await expect(card.getByTestId("thread")).toBeVisible();
  await expect(card.getByText("Gói 1 năm còn ưu đãi")).toBeVisible();
  await expect(card.getByText("gửi báo giá qua đây trong hôm nay")).toBeVisible();
  await expect(card.getByText("Bên mình cần thêm chữ ký HSM")).toBeVisible();
  const toggle = card.getByRole("button", { name: /Bình luận/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(card.getByTestId("thread")).toHaveCount(0);
});

test("bài chưa có bình luận vẫn gập, bấm «Bình luận» mới mở ô viết", async ({ page }) => {
  await page.goto("/community");
  const quiet = page.getByTestId("post").filter({ hasText: "Bình luận (0)" }).first();
  await expect(quiet.getByTestId("thread")).toHaveCount(0);
  await quiet.getByRole("button", { name: /Bình luận/ }).click();
  await expect(quiet.getByRole("combobox", { name: "Viết bình luận" })).toBeVisible();
});
