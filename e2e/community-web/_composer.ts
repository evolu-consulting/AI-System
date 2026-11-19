// CR-191 · ô đăng bài mới: đầu bảng tin chỉ có dòng «Viết bài…»; bấm ⇒ hộp thoại `composer-dialog` (loại bài, Ai thấy bài, «@» nhắc tên).
import { expect, type Locator, type Page } from "@playwright/test";

/** Mở hộp «Viết bài…»; `type` = nhãn loại bài cần chọn («Cần bán» · «Cần mua» · «Thông báo»). Trả về hộp thoại. */
export async function openComposer(page: Page, type?: string): Promise<Locator> {
  await page.getByTestId("composer").getByRole("button", { name: "Viết bài…" }).click();
  const dlg = page.getByTestId("composer-dialog");
  await expect(dlg).toBeVisible();
  if (type) await dlg.getByRole("button", { name: type, exact: true }).click();
  return dlg;
}

/** Gõ «@» trong thân bài ⇒ hộp «Nhắc tên» (`mention-dialog`) mở. */
export async function openMentionFromBody(
  page: Page,
  dlg: Locator,
  lead = "Nhờ",
): Promise<Locator> {
  await dlg.locator("#draft-body").fill(`${lead} @`);
  const m = page.getByTestId("mention-dialog");
  await expect(m).toBeVisible();
  return m;
}
