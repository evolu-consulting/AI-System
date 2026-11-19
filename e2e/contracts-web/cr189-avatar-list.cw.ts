// CR-189 · «Danh sách avatar» (BR-189-3): nhóm ≤ 5 avatar + «+n», bấm mở danh sách (họ tên, chức vụ), Esc đóng, > 8 người cuộn.
// CHƯA chạy lúc viết (chạy cuối đợt). Chưa có trang nào gắn component ở lát này: `fixme` cho tới lát thẻ phòng (cr189-org-card) —
// lát đó bỏ `fixme` và mở trang sơ đồ có `data-testid="org-card-avatars"`.
import { expect, test } from "@playwright/test";

const GROUP = '[data-testid="org-card-avatars"]';

test.fixme("bấm nhóm avatar ⇒ danh sách họ tên + chức vụ; Esc đóng; > 8 người cuộn", async ({
  page,
}) => {
  await page.goto("/org");
  const group = page.locator(GROUP).first();
  await expect(group).toBeVisible();
  await expect(group.locator("[data-slot=avatar-group] > span")).toHaveCount(6, { timeout: 5000 }); // 5 avatar + «+n»
  await group.click();
  const list = page.locator("[data-slot=avatar-list]");
  await expect(list).toBeVisible();
  await expect(list.locator("[data-slot=avatar-list-row]").first()).toContainText(/\S/);
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(group).toBeFocused();
});
