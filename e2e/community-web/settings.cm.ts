// CR-110 · COM-FR-38..42 · CR-130 · e2e Cài đặt: MỘT hộp thoại cho cả app (Sổ Hợp Tác + Bảng tin). VIẾT, CHƯA CHẠY (chạy một lần cuối đợt).
import { expect, type Page, test } from "@playwright/test";

const as = async (page: Page, id: string) => {
  await page.getByLabel("Chọn nhân vật").selectOption(id);
};
const open = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "Tài khoản" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
};

test("đối tác: chỉ ngăn Bảng tin › Thông báo, không có Sổ Hợp Tác trong DOM", async ({ page }) => {
  await page.goto("/community");
  await as(page, "tp");
  await open(page, "Cài đặt");
  await expect(page.getByTestId("settings-nav-feed")).toBeVisible();
  for (const sec of ["co", "rep", "biz", "scout", "flow"])
    await expect(page.getByTestId(`settings-nav-${sec}`)).toHaveCount(0);
  await expect(page.getByRole("switch").first()).toBeVisible(); // công tắc thông báo (tự lưu)
  expect(await page.locator("body").innerHTML()).not.toContain("Sổ Hợp Tác");
});

test("Admin: hai nhóm trong cùng một hộp thoại (Hợp đồng & giao dịch · Bảng tin); không còn mục Ngôn ngữ/Màu chủ đạo riêng", async ({
  page,
}) => {
  await page.goto("/community");
  await as(page, "an");
  await open(page, "Cài đặt Sổ Hợp Tác");
  await expect(
    page.getByTestId("settings-group-contracts").getByTestId("settings-group-head"),
  ).toHaveText("Hợp đồng & giao dịch");
  await expect(
    page.getByTestId("settings-group-feed").getByTestId("settings-group-head"),
  ).toHaveText("Bảng tin");
  for (const old of ["lang", "brand", "notify"])
    await expect(page.getByTestId(`settings-nav-${old}`)).toHaveCount(0);
  for (const sec of ["co", "rep", "biz", "scout", "flow", "feed"]) {
    await page.getByTestId(`settings-nav-${sec}`).click();
    expect(new URL(page.url()).pathname).toBe("/community");
  }
});

test("link cũ /community?settings=1 mở Cài đặt chung ở mục Bảng tin rồi bỏ ?settings", async ({
  page,
}) => {
  await page.goto("/community?settings=1");
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
  await expect(page.getByTestId("settings-nav-feed")).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(/\/community$/);
});
// CR-130 p3: ca «thành viên chủ quản không có quyền Sổ Hợp Tác» đã bỏ — Bảng tin = gói contracts + add-on nên không còn người dùng như vậy.
