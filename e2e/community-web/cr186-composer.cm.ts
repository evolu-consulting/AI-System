// CR-186 (viết, CHƯA chạy) · ô đăng bài trên điện thoại 390px: loại bài một hàng cuộn ngang ≥ 44px, ô dính + thu một dòng «Viết bài…»;
// hộp «Nhắc tên»: lọc nhóm + tìm tên, dòng ≥ 44px; 3 bình luận mới nhất. Adapter mock (persona mặc định = chủ quản).
import { expect, type Page, test } from "@playwright/test";
import { MOBILE_USE } from "../_kit/mobile-rules";

const scrollFeed = (page: Page, y: number) =>
  page.evaluate((top) => {
    // vùng cuộn chính của shell = tổ tiên có overflow-y auto gần bảng tin nhất
    let el: HTMLElement | null = document.querySelector(".feedwrap");
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    (el ?? document.scrollingElement)?.scrollTo({ top });
  }, y);

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

  test("ô đăng mở: loại bài là một hàng nút ≥ 44px, không tràn ngang", async ({ page }) => {
    await openComposerPref(page);
    await page.goto("/community");
    const composer = page.getByTestId("composer");
    await composer.getByRole("button", { name: /đang có hàng cần bán/ }).click();
    const seg = composer.getByRole("group", { name: "Loại bài" });
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
    const box = await composer.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  });

  test("cuộn xuống: ô đăng dính dưới thanh trên, thu thành «Viết bài…», bấm ⇒ mở đầy đủ", async ({
    page,
  }) => {
    await openComposerPref(page);
    await page.goto("/community");
    await expect(page.getByTestId("post").first()).toBeVisible();
    await scrollFeed(page, 600);
    const compact = page.getByTestId("composer");
    await expect(compact).toHaveAttribute("data-compact", "true");
    await expect(compact.getByRole("button", { name: "Viết bài…" })).toBeVisible();
    const top = (await compact.boundingBox())?.y ?? 999;
    expect(top).toBeLessThan(140); // dính ngay dưới thanh đầu trang
    await compact.getByRole("button", { name: "Viết bài…" }).click();
    await expect(page.getByRole("textbox", { name: "Nội dung bài đăng" })).toBeVisible();
    await expect(page.getByTestId("composer")).not.toHaveAttribute("data-compact", "true");
  });

  test("hộp Nhắc tên: dòng cao ≥ 44px, bộ lọc nhóm không tràn", async ({ page }) => {
    await openComposerPref(page);
    await page.goto("/community");
    await page
      .getByTestId("composer")
      .getByRole("button", { name: "Cần bán", exact: true })
      .click();
    await page.getByRole("button", { name: "Nhắc tên" }).click();
    const dlg = page.getByTestId("mention-dialog");
    const rows = dlg.getByTestId("mention-option");
    await expect(rows.first()).toBeVisible();
    for (let i = 0; i < (await rows.count()); i++) {
      expect((await rows.nth(i).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const g = await dlg.getByTestId("mention-group").boundingBox();
    expect((g?.x ?? 0) + (g?.width ?? 0)).toBeLessThanOrEqual(390);
  });
});

test.describe("CR-186 · máy tính", () => {
  test("Nhắc tên: lọc nhóm Tất cả · Nội bộ · Đối tác · Khách hàng + tìm tên", async ({ page }) => {
    await page.goto("/community");
    await page
      .getByTestId("composer")
      .getByRole("button", { name: "Cần bán", exact: true })
      .click();
    await page.getByRole("button", { name: "Nhắc tên" }).click();
    const dlg = page.getByTestId("mention-dialog");
    const rows = dlg.getByTestId("mention-option");
    await expect(rows).toHaveCount(4); // Tất cả
    await dlg.getByRole("combobox", { name: "Nhóm người" }).click();
    for (const name of ["Tất cả", "Nội bộ", "Đối tác", "Khách hàng"])
      await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
    await page.getByRole("option", { name: "Khách hàng", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Trần B");
    await expect(rows.first()).toContainText("Công ty TNHH ABC");
    await dlg.getByRole("combobox", { name: "Nhóm người" }).click();
    await page.getByRole("option", { name: "Nội bộ", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await dlg.getByRole("searchbox", { name: "Tìm theo tên" }).fill("Lan");
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole("checkbox").check();
    await dlg.getByRole("button", { name: "Xong (1 người)" }).click();
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
