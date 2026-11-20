// CR-186 (viết, CHƯA chạy) · ô đăng bài trên điện thoại 390px: loại bài một hàng cuộn ngang ≥ 44px, ô dính + thu một dòng «Viết bài…»;
// hộp «Nhắc tên»: lọc nhóm + tìm tên, dòng ≥ 44px; 3 bình luận mới nhất. Adapter mock (persona mặc định = chủ quản).
import { expect, type Page, test } from "@playwright/test";
import { MOBILE_USE } from "../_kit/mobile-rules";
import { openComposer, openMentionFromBody } from "./_composer";

const openComposerPref = (page: Page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });

test.describe("CR-186 · điện thoại 390px", () => {
  test.use(MOBILE_USE);

  test("hộp «Viết bài…»: loại bài là một hàng nút ≥ 44px, không tràn ngang", async ({ page }) => {
    await openComposerPref(page);
    await page.goto("/community");
    const dlg = await openComposer(page);
    const seg = dlg.getByRole("group", { name: "Loại bài" });
    await expect(seg).toBeVisible();
    const buttons = seg.getByRole("button");
    await expect(buttons).toHaveCount(3); // chủ quản: Cần bán · Cần mua · Thông báo
    for (let i = 0; i < 3; i++) {
      const b = await buttons.nth(i).boundingBox();
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const ys = await Promise.all(
      [0, 1, 2].map(async (i) => (await buttons.nth(i).boundingBox())?.y),
    );
    expect(new Set(ys.map((y) => Math.round(y ?? 0))).size).toBe(1); // cùng một hàng
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    const box = await dlg.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  });

  test("danh sách thả «@»: dòng cao ≥ 44px, không tràn ngang", async ({ page }) => {
    await openComposerPref(page);
    await page.goto("/community");
    await openMentionFromBody(page, await openComposer(page, "Cần bán"));
    const list = page.getByTestId("mention-suggest");
    const rows = list.getByTestId("mention-option");
    await expect(rows.first()).toBeVisible();
    for (let i = 0; i < (await rows.count()); i++) {
      expect((await rows.nth(i).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const g = await list.boundingBox();
    expect((g?.x ?? 0) + (g?.width ?? 0)).toBeLessThanOrEqual(390);
  });
});

test.describe("CR-186 · máy tính", () => {
  test("«@» trong thân bài: danh sách thả đủ 6 người, gõ tên lọc, chọn ⇒ chip", async ({
    page,
  }) => {
    await page.goto("/community");
    const comp = await openComposer(page, "Cần bán");
    await openMentionFromBody(page, comp);
    const rows = page.getByTestId("mention-option");
    await expect(rows).toHaveCount(6); // 4 người công ty mình + 2 người công ty đã kết nối (CR-191)
    await comp.locator("#draft-body").pressSequentially("Trần");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Trần B");
    await expect(rows.first()).toContainText("Công ty TNHH ABC");
    await rows.first().click();
    await expect(page.getByTestId("mention-chip")).toHaveCount(1);
  });

  test("3 bình luận mới nhất: bài 4 bình luận hiện 3 + «Xem thêm 1 bình luận»", async ({
    page,
  }) => {
    await page.goto("/community");
    const card = page.locator('[data-post-id="p1"]');
    await expect(card.getByText("Bên mình cần thêm chữ ký HSM")).toBeVisible(); // 3 bình luận ⇒ mở sẵn, không bấm «Bình luận» (CR-186 fix)
    await expect(card.getByTestId("comments-more")).toHaveCount(0);
    await card.getByRole("combobox", { name: "Viết bình luận" }).fill("Bình luận thứ tư");
    await card.getByRole("button", { name: "Gửi bình luận" }).click();
    await expect(card.getByText("Bình luận thứ tư")).toBeVisible();
    await expect(card.getByText("Bên mình cần thêm chữ ký HSM")).toHaveCount(0);
    await card.getByRole("button", { name: "Xem thêm 1 bình luận" }).click();
    await expect(card.getByText("Bên mình cần thêm chữ ký HSM")).toBeVisible();
  });
});
