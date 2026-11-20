// CR-191 · ô đăng bài mới: đầu bảng tin chỉ có dòng «Viết bài…»; bấm ⇒ hộp thoại `composer-dialog` (loại bài, Ai thấy bài, «@» nhắc tên).
import { expect, type Locator, type Page } from "@playwright/test";

/** Chờ mọi hiệu ứng CSS hữu hạn trên trang xong (không sleep). */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/** Mở hộp «Viết bài…»; `type` = nhãn loại bài cần chọn («Cần bán» · «Cần mua» · «Thông báo»). Trả về hộp thoại. */
export async function openComposer(page: Page, type?: string): Promise<Locator> {
  await page.getByTestId("composer").getByRole("button", { name: "Viết bài…" }).click();
  const dlg = page.getByTestId("composer-dialog");
  await expect(dlg).toBeVisible();
  await settled(page); // hộp mở có hiệu ứng phóng to ⇒ đo khung (boundingBox) chỉ đúng khi hiệu ứng đã xong
  if (type) await dlg.getByRole("button", { name: type, exact: true }).click();
  return dlg;
}

/** Gõ «@» trong thân bài ⇒ danh sách thả tại chỗ (`mention-suggest`) mở (CR-193: không còn hộp «Nhắc tên»). */
export async function openMentionFromBody(
  page: Page,
  dlg: Locator,
  lead = "Nhờ",
): Promise<Locator> {
  await dlg.locator("#draft-body").fill(`${lead} @`);
  const m = page.getByTestId("mention-suggest");
  await expect(m).toBeVisible();
  return m;
}

/** Đóng hộp «Viết bài…» (Esc) — hộp là modal, còn mở thì phần còn lại của trang bị ẩn khỏi cây trợ năng. */
export async function closeComposer(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("composer-dialog")).toHaveCount(0);
}
