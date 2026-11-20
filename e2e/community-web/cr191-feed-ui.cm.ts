// CR-191 · e2e Community (adapter mock, persona mặc định = chủ quản Admin): bảng tin gộp một cột — tải 20 bài/lần khi cuộn,
// nhãn Công ty mình / Đối tác, lọc loại + nguồn trong sheet, «Xoá lọc», đổi lọc không làm khung nhảy, icon thẻ bài 28/44px.
// Mock có 2 công ty kết nối × 14 bài (adapters/mock-connected.ts). VIẾT, điều phối chạy cuối đợt.
import { expect, type Page, test } from "@playwright/test";

const posts = (page: Page) => page.getByTestId("post");
const openFilter = async (page: Page) => {
  await page.getByTestId("feed-filter-btn").click();
  await expect(page.getByTestId("feed-filter-sheet")).toBeVisible();
};
const closeFilter = (page: Page) => page.getByRole("button", { name: "Xong" }).click();
const CONNECTED_A = "c0000000-0000-4000-8000-00000000000a";

test("cuộn tải 20 bài mỗi lần, hết bài thì dừng", async ({ page }) => {
  await page.goto("/community");
  await expect(posts(page)).toHaveCount(20);
  await page.getByTestId("feed-more").scrollIntoViewIfNeeded();
  // dữ liệu giả: 8 bài công ty mình + 2 công ty × 14 bài đối tác = 36 ⇒ trang 2 chỉ còn 16 (< 20) ⇒ hết bài, dừng
  await expect(posts(page)).toHaveCount(36);
  await expect(page.getByTestId("feed-more")).toHaveCount(0);
});

test("đầu bài: tên, chức vụ, công ty, nhãn Công ty mình / Đối tác, bài Đối tác chỉ xem, không có ô bình luận", async ({
  page,
}) => {
  await page.goto("/community");
  const own = posts(page).first();
  await expect(own.getByTestId("post-source")).toHaveText("Công ty mình");
  await expect(own.getByTestId("post-company")).toBeVisible();
  await openFilter(page);
  await page.getByTestId("filter-source-connected").click();
  await closeFilter(page);
  const partner = posts(page).first();
  await expect(partner.getByTestId("post-source")).toHaveText("Đối tác");
  await expect(partner.getByTestId("post-author")).not.toHaveText("");
  await expect(partner).toContainText("Trưởng phòng kinh doanh");
  await expect(partner.getByTestId("post-company")).toContainText("Công ty");
  // CR-191 BR-191-12 (spec đổi nghĩa): bài đối tác có ô bình luận, không còn nhãn «chỉ xem»
  await expect(partner.getByTestId("post-viewonly")).toHaveCount(0);
  await expect(partner.locator(".pact")).toHaveCount(1);
  // bài Đối tác: có bình luận, không Báo cáo / Sửa / Xoá (kiểm duyệt thuộc công ty đăng)
  await expect(partner.getByTestId("post-acts")).toHaveCount(0);
  await expect(partner.getByRole("button", { name: /Báo cáo|Sửa bài|Xoá bài/ })).toHaveCount(0);
});

test("lọc loại + nguồn, số lọc đang bật, «Xoá lọc»", async ({ page }) => {
  await page.goto("/community");
  await expect(page.getByTestId("feed-filter-n")).toHaveCount(0);
  await openFilter(page);
  await page.getByTestId("filter-source-connected").click();
  await expect(page.getByTestId("filter-source-connected")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("filter-type-sell").click();
  await expect(page.getByTestId("feed-filter-n")).toHaveText("2");
  await closeFilter(page);
  await expect(posts(page).first()).toBeVisible();
  const sources = await posts(page).getByTestId("post-source").allTextContents();
  expect(sources.length).toBeGreaterThan(0);
  expect(new Set(sources)).toEqual(new Set(["Đối tác"]));
  await expect(posts(page).locator(".pill.sell")).toHaveCount(sources.length);
  // «Công ty mình» có số đếm theo loại; nguồn đối tác không có số
  await openFilter(page);
  await page.getByTestId("filter-source-own").click();
  await expect(page.getByTestId("filter-type-sell").locator(".n")).toBeVisible();
  await expect(page.getByTestId("filter-source-connected").locator(".n")).toHaveCount(0);
  await page.getByTestId("filter-clear").click();
  await expect(page.getByTestId("feed-filter-n")).toHaveCount(0);
  await closeFilter(page);
  await expect(posts(page)).toHaveCount(20);
});

test("lọc theo một công ty đã kết nối", async ({ page }) => {
  await page.goto("/community");
  await openFilter(page);
  await page.getByTestId(`filter-source-${CONNECTED_A}`).click();
  await closeFilter(page);
  await expect(posts(page).first()).toBeVisible();
  const names = await posts(page).getByTestId("post-company").allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names)).toEqual(new Set(["Công ty Thép Đại Phát"]));
});

test("đổi lọc: cột bài và nút Lọc không nhảy (đo bounding box)", async ({ page }) => {
  await page.goto("/community");
  await expect(posts(page).first()).toBeVisible();
  const box = async () => ({
    col: await page.locator(".feedbody").boundingBox(),
    first: await posts(page).first().boundingBox(),
    btn: await page.getByTestId("feed-filter-btn").boundingBox(),
  });
  const before = await box();
  await openFilter(page);
  await page.getByTestId("filter-source-own").click();
  await closeFilter(page);
  await expect(page.getByTestId("feed-filter-n")).toHaveText("1");
  await expect(posts(page).first()).toBeVisible();
  const after = await box();
  expect(after.col?.x).toBe(before.col?.x);
  expect(after.col?.width).toBe(before.col?.width);
  expect(after.first?.x).toBe(before.first?.x);
  expect(after.first?.width).toBe(before.first?.width);
  expect(after.btn?.x).toBe(before.btn?.x);
  expect(after.btn?.y).toBe(before.btn?.y);
});

test("icon Sửa/Xoá/Ẩn ở thẻ bài: 28px cách 2px trên máy tính, có tên đọc được", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/community");
  const acts = page.getByTestId("post-acts").first();
  await expect(acts).toBeVisible();
  const btns = acts.locator(".iconact");
  const n = await btns.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    const b = await btns.nth(i).boundingBox();
    expect(b?.width).toBe(28);
    expect(b?.height).toBe(28);
    await expect(btns.nth(i)).toHaveAttribute("aria-label", /\S/);
    await expect(btns.nth(i)).toHaveText("");
  }
  const [a, b] = [await btns.nth(0).boundingBox(), await btns.nth(1).boundingBox()];
  expect(Math.round((b?.x ?? 0) - ((a?.x ?? 0) + (a?.width ?? 0)))).toBe(2);
  await expect(page.getByRole("menuitem", { name: "Sửa bài" })).toHaveCount(0); // không còn menu ⋯ có chữ
});

test("điện thoại: icon thẻ bài 44px sát nhau, nút Lọc nổi đáy mở sheet từ dưới", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/community");
  const btns = page.getByTestId("post-acts").first().locator(".iconact");
  await expect(btns.first()).toBeVisible();
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = await btns.nth(i).boundingBox();
    expect(b?.width).toBeGreaterThanOrEqual(44);
    expect(b?.height).toBeGreaterThanOrEqual(44);
  }
  const fab = page.getByTestId("feed-filter-btn");
  const f = await fab.boundingBox();
  expect(f && f.y + f.height).toBeGreaterThan(844 - 80); // nút nổi sát đáy
  await fab.click();
  await expect(page.getByTestId("feed-filter-sheet")).toHaveAttribute("data-side", "bottom");
});

test("điện thoại: không còn thanh bo tròn trống dưới ô đăng bài, nút Lọc nằm trên thanh đáy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/community");
  await expect(page.locator(".feedbar")).toHaveCount(0);
  const fab = await page.getByTestId("feed-filter-btn").boundingBox();
  const nav = await page
    .getByRole("navigation", { name: /đáy|Điều hướng/i })
    .first()
    .boundingBox();
  expect(fab && nav).toBeTruthy();
  expect((fab?.y ?? 0) + (fab?.height ?? 0)).toBeLessThanOrEqual(nav?.y ?? 0);
});

// CR-193 BR-193-2/5 · máy tính: nút Lọc nổi (không thanh lọc dính), ô đăng bài cuộn đi theo trang; không có nút «Nhắc tên» ở bình luận (BR-193-1).
test("CR193 · máy tính: nút Lọc nổi góc phải dưới, ô đăng bài không dính khi cuộn", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/community");
  await expect(posts(page).first()).toBeVisible();
  await expect(page.locator(".feedbar")).toHaveCount(0);
  const fab = page.getByTestId("feed-filter-btn");
  await expect(fab).toHaveCSS("position", "fixed");
  const f = await fab.boundingBox();
  expect(f && f.x + f.width).toBeGreaterThan(1440 - 80); // sát mép phải
  expect(f && f.y + f.height).toBeGreaterThan(900 - 160); // sát đáy
  const before = await page.getByTestId("composer").boundingBox();
  // vùng cuộn là <main data-scroll-restoration-id="main-scroll"> của shell, không phải window (wheel ở (0,0) nằm trên thanh bên)
  await page
    .locator('[data-scroll-restoration-id="main-scroll"]')
    .evaluate((el) => el.scrollTo({ top: 600 }));
  await expect
    .poll(async () => (await page.getByTestId("composer").boundingBox())?.y)
    .toBeLessThan((before?.y ?? 0) - 100); // ô đăng bài cuộn đi, không dính
  await expect(fab).toBeVisible(); // nút Lọc vẫn nổi
});

test("CR193 · bình luận: không có nút «Nhắc tên», gõ @ vẫn mở hộp gợi ý", async ({ page }) => {
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  const box = card.getByRole("combobox", { name: "Viết bình luận" });
  await expect(box).toBeVisible();
  await expect(card.getByRole("button", { name: "Nhắc tên" })).toHaveCount(0);
  await box.pressSequentially("@");
  await expect(card.getByTestId("mention-suggest")).toBeVisible(); // danh sách thả tại chỗ, không hộp thoại
  await expect(page.getByTestId("mention-dialog")).toHaveCount(0);
});

// CR-193 UAT 7 · «Lọc» có đủ nguồn: Tất cả · Công ty mình · Đối tác · từng công ty đã kết nối (lấy từ gói Community, cùng nguồn «Ai thấy bài»).
test("CR193 · Lọc: có «Đối tác» và từng công ty đã kết nối", async ({ page }) => {
  await page.goto("/community");
  await openFilter(page);
  const sheet = page.getByTestId("feed-filter-sheet");
  for (const id of ["all", "own", "connected", CONNECTED_A])
    await expect(sheet.getByTestId(`filter-source-${id}`)).toBeVisible();
  await sheet.getByTestId("filter-source-connected").click();
  await expect(posts(page).first()).toBeVisible();
  await expect(page.getByTestId("post-source").first()).toHaveAttribute("data-source", "connected");
});
