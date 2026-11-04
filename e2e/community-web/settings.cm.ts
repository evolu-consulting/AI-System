// CR-110 · COM-FR-38..42 · e2e hộp thoại Cài đặt (adapter mock + persona). VIẾT, CHƯA CHẠY (chạy một lần cuối đợt).
import { expect, type Page, test } from "@playwright/test";

const as = async (page: Page, id: string) => {
  await page.getByLabel("Chọn nhân vật").selectOption(id);
};
const open = async (page: Page) => {
  await page.getByRole("button", { name: "Tài khoản" }).click();
  await page.getByRole("menuitem", { name: "Cài đặt chung" }).click();
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
};

test("đối tác: chỉ nhóm Cá nhân, không có Sổ Hợp Tác / Công ty trong DOM", async ({ page }) => {
  await page.goto("/community");
  await as(page, "tp");
  await open(page);
  await expect(page.getByTestId("settings-group-personal")).toBeVisible();
  await expect(page.getByTestId("settings-group-company")).toHaveCount(0);
  await expect(page.getByTestId("settings-group-sht")).toHaveCount(0);
  await expect(page.getByTestId("settings-sht-link")).toHaveCount(0);
  expect(await page.locator("body").innerHTML()).not.toContain("Sổ Hợp Tác");
});

test("Admin: mục Sổ Hợp Tác nằm trong dialog Cài đặt, không đổi URL ngoài ?settings=", async ({
  page,
}) => {
  await page.goto("/community");
  await as(page, "an");
  await open(page);
  await expect(page.getByTestId("settings-group-sht")).toBeVisible();
  await expect(page.getByTestId("settings-group-sht").locator(".sidehead")).toHaveAttribute(
    "title",
    "Áp dụng cho cả công ty",
  );
  await expect(
    page.getByTestId("settings-group-personal").locator(".sidehead"),
  ).not.toHaveAttribute("title", /.+/);
  for (const sec of ["co", "rep", "biz", "scout", "flow"]) {
    await page.getByTestId(`settings-nav-${sec}`).click();
    await expect(page.getByTestId("settings-sht-link")).toHaveAttribute("data-sec", sec);
    expect(new URL(page.url()).pathname).toBe("/community");
  }
});
test("thành viên chủ quản không phải Admin: mục Công ty báo chưa có quyền", async ({ page }) => {
  await page.goto("/community");
  await as(page, "cuong");
  await open(page);
  await page.getByTestId("settings-nav-brand").click();
  await expect(page.getByTestId("settings-no-perm")).toBeVisible();
});

test("ngôn ngữ: chọn English đổi nhãn và lưu ai.locale", async ({ page }) => {
  await page.goto("/community");
  await open(page);
  await page.getByTestId("settings-nav-lang").click();
  await page.getByRole("button", { name: "English" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ai.locale"))).toBe("en");
});
