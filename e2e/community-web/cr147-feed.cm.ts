// CR-147 · e2e Bảng tin (adapter mock): bình luận chỉ hiện 2 mới nhất + «Xem thêm», sửa bài thêm/bớt tệp, nút thu gọn ô đăng thẳng hàng.
import { expect, test } from "@playwright/test";

const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.alloc(1024, 1),
});

test("bài có 3 bình luận: mặc định 2 mới nhất, «Xem thêm 1 bình luận» mở phần cũ", async ({
  page,
}) => {
  // mock ở trong bộ nhớ ⇒ không reload; dùng bài p1 của seed (3 bình luận: «Anh Hưng» cũ nhất, rồi 2 bình luận mới hơn)
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  await card.getByRole("button", { name: /Bình luận/ }).click();
  await expect(card.getByText("Gói 1 năm còn ưu đãi")).toBeVisible();
  await expect(card.getByText("gửi báo giá qua đây trong hôm nay")).toBeVisible();
  await expect(card.getByText("Bên mình cần thêm chữ ký HSM")).toHaveCount(0);
  await card.getByRole("button", { name: "Xem thêm 1 bình luận" }).click();
  await expect(card.getByText("Bên mình cần thêm chữ ký HSM")).toBeVisible();
  await expect(card.getByTestId("comments-more")).toHaveCount(0);
});

test("sửa bài: bớt một tệp, thêm một tệp, lưu ⇒ thẻ tệp đổi theo", async ({ page }) => {
  await page.goto("/community");
  await page.getByTestId("composer").getByRole("button", { name: "Cần bán", exact: true }).click();
  await page.getByLabel("Hàng hoá", { exact: true }).fill("Bài sửa tệp");
  await page.getByLabel("Số lượng").fill("2 thùng");
  await page.getByTestId("attach-input").setInputFiles([pdf("cu.pdf"), pdf("giu.pdf")]);
  await page.getByRole("button", { name: "Đăng bài" }).click();
  const posted = page.getByTestId("post").filter({ hasText: "Bài sửa tệp" }).first();
  const card = page.locator(`[data-post-id="${await posted.getAttribute("data-post-id")}"]`);
  await expect(card.getByTestId("file-card")).toHaveCount(2);
  await card.getByRole("button", { name: "Tuỳ chọn bài đăng" }).click();
  await page.getByRole("menuitem", { name: "Sửa bài" }).click();
  const edit = card.getByTestId("edit-attach");
  await expect(edit.getByTestId("draft-file")).toHaveCount(2);
  await edit
    .getByTestId("draft-file")
    .filter({ hasText: "cu.pdf" })
    .getByTestId("draft-remove")
    .click();
  await card.getByTestId("edit-attach-input").setInputFiles(pdf("moi.pdf"));
  await expect(edit.getByTestId("draft-file")).toHaveCount(2);
  await card.getByRole("button", { name: "Lưu thay đổi" }).click();
  const files = card.getByTestId("file-card");
  await expect(files).toHaveCount(2);
  await expect(card.getByText("cu.pdf")).toHaveCount(0);
  await expect(card.getByText("giu.pdf")).toBeVisible();
  await expect(card.getByText("moi.pdf")).toBeVisible();
});

test("ô đăng mở: nút thu gọn cùng hàng, cùng chiều cao và căn giữa dọc với nút loại bài", async ({
  page,
}) => {
  await page.goto("/community");
  await page.getByTestId("composer").getByRole("button", { name: "Cần bán", exact: true }).click();
  const collapse = await page.getByTestId("composer-collapse").boundingBox();
  const seg = await page.getByTestId("composer").locator(".seg button").first().boundingBox();
  if (!collapse || !seg) throw new Error("thiếu nút");
  expect(Math.abs(collapse.height - seg.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(collapse.y + collapse.height / 2 - (seg.y + seg.height / 2))).toBeLessThanOrEqual(
    1,
  );
});

test("hộp Nhắc tên: nút chỉ biểu tượng, tìm, chọn 2 người, «Xong (2 người)» ⇒ chip ở ô đăng; Huỷ không đổi", async ({
  page,
}) => {
  await page.goto("/community");
  await page.getByTestId("composer").getByRole("button", { name: "Cần bán", exact: true }).click();
  await expect(page.getByTestId("mention-people")).toHaveCount(0); // không còn ô gõ tên cũ
  await page.getByRole("button", { name: "Nhắc tên" }).click();
  const dlg = page.getByTestId("mention-dialog");
  await dlg.getByRole("searchbox", { name: "Tìm theo tên" }).fill("Lan");
  await expect(dlg.getByTestId("mention-option")).toHaveCount(1);
  await dlg.getByRole("searchbox", { name: "Tìm theo tên" }).fill("");
  await dlg.getByTestId("mention-option").filter({ hasText: "Lan" }).getByRole("checkbox").check();
  await dlg.getByTestId("mention-option").filter({ hasText: "Minh" }).getByRole("checkbox").check();
  await dlg.getByRole("button", { name: "Xong (2 người)" }).click();
  await expect(page.getByTestId("mention-chip")).toHaveCount(2);
  await page.getByRole("button", { name: "Nhắc tên" }).click();
  await page.getByTestId("mention-dialog").getByRole("button", { name: "Huỷ" }).click();
  await expect(page.getByTestId("mention-chip")).toHaveCount(2);
});

// CR-179 (chưa chạy trên evotest) · ô đăng bài thẳng hàng thẻ «Bộ lọc»; logo công ty cùng hàng chữ «Công ty»; trang trống canh giữa.
test("CR-179: mép trên ô đăng bài = mép trên thẻ «Bộ lọc» (lệch ≤ 1px)", async ({ page }) => {
  await page.goto("/community");
  const comp = await page.getByTestId("composer").boundingBox();
  const filt = await page.locator(".rail .rcard").first().boundingBox();
  expect(comp && filt).toBeTruthy();
  expect(Math.abs((comp?.y ?? 0) - (filt?.y ?? 99))).toBeLessThanOrEqual(1);
});

test("CR-179: /community/me — logo công ty tròn, cùng hàng với chữ «Công ty»", async ({ page }) => {
  await page.goto("/community/me");
  const logo = await page.getByTestId("me-company-logo").boundingBox();
  const name = await page.getByTestId("me-company-row").locator("b").boundingBox();
  expect(logo && name).toBeTruthy();
  const mid = (b: { y: number; height: number } | null) => (b?.y ?? 0) + (b?.height ?? 0) / 2;
  expect(Math.abs(mid(logo) - mid(name))).toBeLessThanOrEqual(2);
  const radius = await page
    .getByTestId("me-company-logo")
    .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(parseFloat(radius)).toBeGreaterThanOrEqual(16);
});

test("CR-179: «Báo cáo vi phạm» không có dữ liệu ⇒ trạng thái trống canh giữa vùng nội dung", async ({
  page,
}) => {
  await page.goto("/community/reports");
  const empty = page.getByTestId("reports-list-empty");
  test.skip(!(await empty.isVisible().catch(() => false)), "seed mock có báo cáo");
  const a = await empty.boundingBox();
  const area = await page.locator(".wsmain").boundingBox();
  expect(a && area).toBeTruthy();
  const cx = (b: { x: number; width: number } | null) => (b?.x ?? 0) + (b?.width ?? 0) / 2;
  const cy = (b: { y: number; height: number } | null) => (b?.y ?? 0) + (b?.height ?? 0) / 2;
  expect(Math.abs(cx(a) - cx(area))).toBeLessThanOrEqual(16);
  expect(Math.abs(cy(a) - cy(area))).toBeLessThanOrEqual(16);
});

test("CR-179: avatar header và sidebar cùng màu nền", async ({ page }) => {
  await page.goto("/community");
  const bg = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  const head = await bg('[data-testid="user-chip"] [data-slot="avatar"]');
  const side = await bg('[data-testid="sidebar"] [data-slot="avatar"], aside [data-slot="avatar"]');
  expect(head).toBe(side);
});
