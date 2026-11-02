// CR-110 · COM-FR-35..37 · e2e hồ sơ community-web (mock + persona switcher). VIẾT, CHƯA CHẠY (Luật 0b).
import { expect, type Page, test } from "@playwright/test";

const as = async (page: Page, id: string) => {
  await page.getByLabel("Chọn nhân vật").selectOption(id);
};

test.describe("hồ sơ: chủ quản vs đối tác", () => {
  test("chủ quản (Admin): 4 tab, hstat Bạn bè, tab Đối tác có cột Uy tín", async ({ page }) => {
    await page.goto("/#/feed");
    await as(page, "an");
    await page.goto("/#/profile");
    for (const id of ["about", "posts", "partners", "files"])
      await expect(page.getByTestId(`profile-tab-${id}`)).toBeVisible();
    await expect(page.getByTestId("hstat-friends")).toBeVisible();
    await page.getByTestId("profile-tab-partners").click();
    await expect(page.getByTestId("profile-partners")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Uy tín" })).toBeVisible();
  });

  for (const id of ["tp", "abc"]) {
    test(`đối tác ${id}: 3 tab, không tab Đối tác, không Bạn bè, không câu Sổ Hợp Tác`, async ({
      page,
    }) => {
      await page.goto("/#/feed");
      await as(page, id);
      await page.goto("/#/profile");
      await expect(page.getByTestId("profile-tab-partners")).toHaveCount(0);
      await expect(page.getByTestId("hstat-friends")).toHaveCount(0);
      await expect(page.getByRole("tab")).toHaveCount(3);
      expect(await page.locator("body").innerHTML()).not.toContain("Sổ Hợp Tác");
      // gõ tay section chủ quản ⇒ về Bài đăng
      await page.goto(`/#/profile/${id === "tp" ? "tanphat" : "abc"}/partners`);
      await expect(page.getByTestId("profile-partners")).toHaveCount(0);
    });
  }

  test("#/profile/<id>/files mở Ảnh & tệp; section lạ về Bài đăng", async ({ page }) => {
    await page.goto("/#/profile/host/files");
    await expect(page.getByTestId("profile-tab-files")).toHaveAttribute("aria-selected", "true");
    await page.goto("/#/profile/host/zzz");
    await expect(page.getByTestId("profile-tab-posts")).toHaveAttribute("aria-selected", "true");
  });
});
