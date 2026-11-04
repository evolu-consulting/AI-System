// CR-102 · C5 · e2e luồng chính của community-web với adapter mock (persona switcher chỉ có ở mock).
import { expect, test } from "@playwright/test";

const as = async (page: import("@playwright/test").Page, id: string) => {
  await page.getByLabel("Chọn nhân vật").selectOption(id);
};

test("chủ quản: đăng Cần bán, sửa (đã sửa), lưu trữ, xoá có xác nhận", async ({ page }) => {
  await page.goto("/community");
  // topbar hiện thương hiệu công ty chủ quản (GET /brand); nhóm "Sổ Hợp Tác" nằm ở sidebar (chủ quản Admin có quyền)
  await expect(page.locator("header.top button.brand")).toBeVisible();
  await expect(page.getByText("Sổ Hợp Tác").first()).toBeVisible();
  // composer thu gọn: nút loại bài "Cần bán" (aria-label) + ô gợi ý có chữ "cần bán" trong tên ⇒ chọn đúng tên (exact)
  await page.getByTestId("composer").getByRole("button", { name: "Cần bán", exact: true }).click();
  await expect(page.locator("#draft-body")).toBeVisible();
  await page.getByLabel("Hàng hoá", { exact: true }).fill("Keo dán thử");
  await page.getByLabel("Số lượng").fill("10 thùng");
  await page.getByRole("button", { name: "Đăng bài" }).click();
  const posted = page.getByTestId("post").filter({ hasText: "Keo dán thử" }).first();
  await expect(posted).toBeVisible();
  // Khoá theo id: khi sửa, tiêu đề chuyển thành ô nhập nên lọc theo chữ không còn khớp (dải deal không lặp tên hàng).
  const card = page.locator(`[data-post-id="${await posted.getAttribute("data-post-id")}"]`);
  await card.getByRole("button", { name: "Tuỳ chọn bài đăng" }).click();
  await page.getByRole("menuitem", { name: "Sửa bài" }).click();
  await card.getByLabel("Sửa nội dung").fill("Nội dung đã chỉnh");
  await card.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(card.getByText("đã sửa")).toBeVisible();
  await card.getByRole("button", { name: "Tuỳ chọn bài đăng" }).click();
  await page.getByRole("menuitem", { name: "Xoá bài" }).click();
  await expect(card.getByText("Xoá vĩnh viễn bài đăng này?")).toBeVisible();
  await card.getByRole("button", { name: "Xoá", exact: true }).click();
  await expect(page.getByText("Keo dán thử")).toHaveCount(0);
});

test("đối tác: bài của NCC bị che liên hệ, không có Lưu báo giá, không chatbot, ghi chú chỉ chủ quản", async ({
  page,
}) => {
  await page.goto("/community");
  await as(page, "tp");
  await page
    .getByTestId("composer")
    .getByRole("button", { name: /đang có hàng/ })
    .click();
  const mine = page.locator('[data-post-id="p5"]');
  await expect(mine).toContainText("[SỐ ĐIỆN THOẠI]");
  await expect(mine).not.toContainText("0903");
  await expect(page.getByText("Lưu báo giá")).toHaveCount(0);
  // cách ly đối tác (P2-AC04/06): không có callout giá vốn / báo giá đã lưu / rail Đối tác trong DOM
  await expect(page.getByTestId("host-hint")).toHaveCount(0);
  await expect(page.getByTestId("quote-saved")).toHaveCount(0);
  await expect(page.getByTestId("rail-partners")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mở trợ lý giá" })).toHaveCount(0);
  await expect(page.getByTestId("partner-note")).toHaveText("Chỉ chủ quản thấy bài này");
  await expect(page.getByTestId("post").filter({ hasText: "Chữ ký số HSM" })).toHaveCount(0); // audience chỉ người mua
});

test("chủ quản: luồng theo từng công ty + audience preview + nút Lưu báo giá bật và mở form (C7b)", async ({
  page,
}) => {
  await page.goto("/community");
  await page
    .getByTestId("composer")
    .getByRole("button", { name: /đang có hàng/ })
    .click();
  await expect(page.locator("#draft-body")).toBeVisible();
  await page.getByRole("button", { name: "Chọn người xem" }).click();
  await page.getByRole("button", { name: "Chỉ nhà cung cấp" }).click();
  await expect(page.getByTestId("audience-preview")).toContainText("Sẽ hiện với 3 công ty");
  const post = page.locator('[data-post-id="p1"]');
  await post.getByRole("button", { name: /Bình luận/ }).click();
  await expect(post.getByRole("tab", { name: /Hưng Thịnh/ })).toBeVisible();
  await expect(post.getByRole("tab", { name: /ABC/ })).toBeVisible();
  const tp = page.locator('[data-post-id="p5"]');
  const saveBtn = tp.getByRole("button", { name: /Lưu báo giá/ });
  await expect(saveBtn).toBeEnabled(); // C7b: chủ quản được lưu báo giá của NCC
  await saveBtn.click();
  await expect(tp.getByTestId("quote-form")).toBeVisible();
});

test("thông báo, cài đặt và hồ sơ qua user-menu", async ({ page }) => {
  await page.goto("/community");
  await page.locator('button.iconbtn[aria-label="Thông báo"]').click(); // chuông; chip lọc "Thông báo" cùng tên nên không dùng getByRole
  await expect(page.getByRole("dialog", { name: "Thông báo" })).toBeVisible();
  await page.getByRole("button", { name: "Đánh dấu đã đọc" }).click();
  await page.locator('button.iconbtn[aria-label="Thông báo"]').click(); // bấm lại chuông để đóng popover (che user-menu)
  await expect(page.getByRole("dialog", { name: "Thông báo" })).toHaveCount(0);
  // cài đặt + hồ sơ nay nằm trong user-menu (avatar) của Shell
  await page.getByRole("button", { name: "Tài khoản" }).click();
  await page.getByRole("menuitem", { name: "Tường nhà" }).click();
  await expect(page.getByTestId("sht-link").first()).toBeVisible(); // sidebar Shell cũng có sht-link
  await page.getByRole("button", { name: "Tài khoản" }).click();
  await page.getByRole("menuitem", { name: "Cài đặt chung" }).click();
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible(); // màu nhấn = thương hiệu công ty, không còn chọn màu cá nhân (COM-FR-39)
});

test("bảng tin 2 cột: tab sticky, dải deal hiển thị giá chào, rail có bộ lọc và đối tác", async ({
  page,
}) => {
  await page.goto("/community");
  await expect(page.getByRole("tab", { name: /Tất cả/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Cần bán/ }).click();
  await expect(page.getByRole("tab", { name: /Cần bán/ })).toHaveAttribute("aria-selected", "true");
  const deal = page.getByTestId("deal").first();
  await expect(deal).toBeVisible();
  await expect(deal.locator(".hero .k")).toHaveText("Giá chào");
  const rail = page.getByRole("complementary", { name: "Cột phụ bảng tin" });
  await expect(rail.getByLabel("Nhóm hàng")).toBeVisible();
  await expect(rail.getByTestId("rail-partners")).toBeVisible();
  const org = rail.getByTestId("rail-org").first();
  await expect(org).toHaveAttribute("href", /\/community\/profile\//);
  await expect(org).toHaveAttribute("target", "_blank");
});
