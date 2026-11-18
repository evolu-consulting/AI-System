// CR-147 · e2e Bảng tin (adapter mock): bình luận chỉ hiện 3 mới nhất + «Xem thêm» (CR-186: 2 ⇒ 3), sửa bài thêm/bớt tệp, nút thu gọn ô đăng thẳng hàng.
import { expect, test } from "@playwright/test";

const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.alloc(1024, 1),
});

test("bài có 3 bình luận: hiện đủ cả 3, không có «Xem thêm» (CR-186; bài 4 bình luận ở cr186-composer.cm.ts)", async ({
  page,
}) => {
  // mock ở trong bộ nhớ ⇒ không reload; dùng bài p1 của seed (3 bình luận)
  await page.goto("/community");
  const card = page.locator('[data-post-id="p1"]');
  // CR-186 fix: bài có bình luận hiện sẵn khối bình luận ⇒ KHÔNG bấm «Bình luận» (bấm là gập)
  await expect(card.getByText("Gói 1 năm còn ưu đãi")).toBeVisible();
  await expect(card.getByText("gửi báo giá qua đây trong hôm nay")).toBeVisible();
  await expect(card.getByText("Bên mình cần thêm chữ ký HSM")).toBeVisible();
  await expect(card.getByRole("button", { name: /^Xem thêm/ })).toHaveCount(0);
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

test("CR-179: /community/me — logo công ty tròn, cùng hàng với tên công ty", async ({ page }) => {
  await page.goto("/community/me");
  const logo = await page.getByTestId("me-company-logo").boundingBox();
  const name = await page.getByTestId("me-company-row").locator(".truncate").boundingBox();
  expect(logo && name).toBeTruthy();
  // tên công ty cùng hàng logo: tâm dọc của chữ rơi trong chiều cao logo, chữ ở bên phải logo
  const mid = (name?.y ?? 0) + (name?.height ?? 0) / 2;
  expect(mid).toBeGreaterThanOrEqual(logo?.y ?? 0);
  expect(mid).toBeLessThanOrEqual((logo?.y ?? 0) + (logo?.height ?? 0));
  expect(name?.x ?? 0).toBeGreaterThan((logo?.x ?? 0) + (logo?.width ?? 0) - 1);
  const radius = await page
    .getByTestId("me-company-logo")
    .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(parseFloat(radius)).toBeGreaterThanOrEqual(10);
});

test("CR-179: /community/me — tên hiện, không bị phần tử khác đè, có chip vai trò", async ({
  page,
}) => {
  await page.goto("/community/me");
  const h1 = page.getByTestId("me-name");
  await expect(h1).toBeVisible();
  await expect(h1).not.toHaveText("");
  const covered = await h1.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });
  expect(covered).toBe(true);
  await expect(page.getByTestId("me-role")).toBeVisible();
  // vai nằm cùng hàng với tên
  const n = await h1.boundingBox();
  const r = await page.getByTestId("me-role").boundingBox();
  expect(Math.abs((n?.y ?? 0) - (r?.y ?? 99))).toBeLessThanOrEqual(24);
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
  const side = await bg('[data-testid="shell-sidebar"] [data-slot="avatar"]');
  expect(head).toBe(side);
});
