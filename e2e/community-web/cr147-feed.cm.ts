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
