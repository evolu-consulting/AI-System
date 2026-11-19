// CR-191 BR-191-5/6/7/8 (viết, điều phối chạy cuối đợt) · hộp «Viết bài…», hàng hoá gợi ý, «Ai thấy bài» (n/N), «@» trong thân bài
// (nhắc người công ty kết nối ngoài «Ai thấy bài» ⇒ hỏi Thêm công ty / Bỏ nhắc). Adapter mock, persona mặc định = chủ quản.
import { expect, type Page, test } from "@playwright/test";
import { settled } from "./_composer";

const open = async (page: Page) => {
  await page.goto("/community");
  await page.getByRole("button", { name: "Viết bài…" }).click();
  const dlg = page.getByTestId("composer-dialog");
  await expect(dlg).toBeVisible();
  await settled(page); // hộp mở có hiệu ứng phóng to ⇒ đợi xong rồi mới đo khung
  return dlg;
};
const pickAudience = async (page: Page, name: string) => {
  await page.getByRole("combobox", { name: "Ai thấy bài" }).click();
  await page.getByRole("option", { name }).click();
};

test("đầu bảng tin chỉ dòng «Viết bài…», bấm ⇒ hộp thoại có 3 loại bài, Thông báo không có hàng hoá", async ({
  page,
}) => {
  await page.goto("/community");
  const bar = page.getByTestId("composer");
  await expect(bar.getByRole("button", { name: "Viết bài…" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Cần bán", exact: true })).toHaveCount(0);
  const dlg = await open(page);
  for (const n of ["Thông báo", "Cần bán", "Cần mua"])
    await expect(dlg.getByRole("button", { name: n, exact: true })).toBeVisible();
  await expect(dlg.getByTestId("goods-input")).toHaveCount(0);
  await expect(dlg.getByText("Gợi ý mẫu")).toHaveCount(0);
  await dlg.getByRole("button", { name: "Cần bán", exact: true }).click();
  await expect(dlg.getByTestId("goods-input")).toBeVisible();
});

test("Cần bán: gõ hàng hoá có gợi ý thả xuống, chọn gợi ý ⇒ điền sẵn đơn vị + đơn giá, số lượng/đơn vị/đơn giá không bắt buộc", async ({
  page,
}) => {
  const dlg = await open(page);
  await dlg.getByRole("button", { name: "Cần bán", exact: true }).click();
  await dlg.getByTestId("goods-input").fill("băng");
  await dlg.getByTestId("goods-option").filter({ hasText: "Băng keo 5cm" }).click();
  await expect(dlg.getByTestId("goods-input")).toHaveValue("Băng keo 5cm");
  await expect(dlg.getByLabel("Đơn vị")).toHaveValue("cuộn");
  await expect(dlg.getByLabel("Giá", { exact: false }).first()).toHaveValue("12.000");
  await dlg.getByLabel("Số lượng").fill("");
  await dlg.getByRole("button", { name: "Đăng bài" }).click();
  await expect(page.getByTestId("post").filter({ hasText: "Băng keo 5cm" }).first()).toBeVisible();
});

test("«Ai thấy bài»: mặc định Tất cả đối tác, dưới ô có «n/N công ty đối tác thấy bài», Chỉ nội bộ ⇒ 0", async ({
  page,
}) => {
  const dlg = await open(page);
  await expect(dlg.getByRole("combobox", { name: "Ai thấy bài" })).toContainText("Tất cả đối tác");
  await expect(dlg.getByTestId("audience-preview")).toHaveText(
    /^\d+\/\d+ công ty đối tác thấy bài$/,
  );
  await expect(dlg.getByRole("button", { name: "Nhắc tên" })).toHaveCount(0); // không còn nút «Nhắc tên» riêng
  await pickAudience(page, "Chỉ nội bộ");
  await expect(dlg.getByTestId("audience-preview")).toHaveText(/^0\/\d+ công ty đối tác thấy bài$/);
});

test("«@» trong thân bài: nhắc người công ty kết nối ngoài «Ai thấy bài» ⇒ hỏi, chưa chọn thì chưa đăng được, Thêm công ty vào ⇒ đăng được", async ({
  page,
}) => {
  const dlg = await open(page);
  await pickAudience(page, "Chỉ nội bộ");
  await dlg.locator("#draft-body").fill("Nhờ @");
  await expect(page.getByTestId("mention-dialog")).toBeVisible();
  const row = page.getByTestId("mention-option").filter({ hasText: "Phạm Thu Hà" });
  await expect(row).toContainText("Trưởng phòng mua hàng"); // chức vụ
  await expect(row).toContainText("Công ty Cổ phần Xanh"); // công ty
  await row.click();
  await page.getByTestId("mention-done").click();
  await expect(dlg.locator("#draft-body")).toHaveValue(/@Phạm Thu Hà/);
  await expect(dlg.getByTestId("mention-outside")).toContainText(
    "Công ty Cổ phần Xanh chưa nằm trong «Ai thấy bài»",
  );
  await dlg.getByRole("button", { name: "Đăng bài" }).click();
  await expect(dlg.getByText("Chọn thêm công ty hoặc bỏ nhắc trước khi đăng.")).toBeVisible();
  await dlg.getByTestId("mention-add-company").click();
  await expect(dlg.getByTestId("mention-outside")).toHaveCount(0);
  await expect(dlg.getByRole("combobox", { name: "Ai thấy bài" })).toContainText("Chọn công ty…");
  await dlg.getByRole("button", { name: "Đăng bài" }).click();
  await expect(page.getByTestId("post").filter({ hasText: "Phạm Thu Hà" }).first()).toBeVisible();
});

test("«@» ngoài «Ai thấy bài»: Bỏ nhắc ⇒ gỡ «@Tên» khỏi thân bài và bỏ người đó", async ({
  page,
}) => {
  const dlg = await open(page);
  await pickAudience(page, "Chỉ nội bộ");
  await dlg.locator("#draft-body").fill("Xin chào @");
  await page.getByTestId("mention-option").filter({ hasText: "Lê Văn Nam" }).click();
  await page.getByTestId("mention-done").click();
  await dlg.getByTestId("mention-drop").click();
  await expect(dlg.getByTestId("mention-outside")).toHaveCount(0);
  await expect(dlg.locator("#draft-body")).not.toHaveValue(/@Lê Văn Nam/);
  await expect(dlg.getByTestId("mention-chip")).toHaveCount(0);
});

test("điện thoại: hộp soạn bài toàn màn", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const dlg = await open(page);
  const box = await dlg.locator("xpath=ancestor::*[@role='dialog']").boundingBox();
  if (!box) throw new Error("không có khung");
  expect(box.width).toBeGreaterThanOrEqual(388);
  expect(box.height).toBeGreaterThanOrEqual(770);
});
