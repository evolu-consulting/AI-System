// CR-110 · COM-FR-27..31, 43 · e2e lớp vỏ community-web (adapter mock + persona switcher). VIẾT, CHƯA CHẠY (Luật 0b: e2e chạy một lần cuối đợt).
// Trọng tâm: cách ly đối tác (I1/I3, HT-75/76) — nhóm "Sổ Hợp Tác" và link contracts KHÔNG có trong DOM (không phải CSS ẩn).
import { expect, type Page, test } from "@playwright/test";

const as = async (page: Page, id: string) => {
  await page.getByLabel("Chọn nhân vật").selectOption(id);
};
const SHT = "Sổ Hợp Tác";
const SHT_PATHS = ["/overview", "/contracts", "/partners", "/products"];

test.describe("cách ly đối tác: DOM không có Sổ Hợp Tác", () => {
  for (const [id, label] of [
    ["tp", "NCC (Tân Phát)"],
    ["abc", "người mua (ABC)"],
    ["cuong", "thành viên chủ quản không có quyền contracts"],
  ] as const) {
    test(`${label}: không nhóm SHT, không sht-link, không chữ "${SHT}" ở trang, user-menu và Cài đặt`, async ({
      page,
    }) => {
      await page.goto("/#/feed");
      await as(page, id);
      await expect(page.getByTestId("nav-group-community")).toBeVisible();
      await expect(page.getByTestId("nav-group-sht")).toHaveCount(0);
      await expect(page.getByTestId("sht-link")).toHaveCount(0);
      expect(await page.locator("body").innerHTML()).not.toContain(SHT);
      // user-menu + hộp thoại Cài đặt cũng sạch
      await page.getByRole("button", { name: "Tài khoản" }).click();
      expect(await page.locator("body").innerHTML()).not.toContain(SHT);
      await page.getByRole("menuitem", { name: "Cài đặt chung" }).click();
      await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
      expect(await page.locator("body").innerHTML()).not.toContain(SHT);
      await page.keyboard.press("Escape");
      // hồ sơ cũng không có link SHT
      await page.goto("/#/profile");
      await expect(page.getByTestId("nav-group-sht")).toHaveCount(0);
      expect(await page.locator("body").innerHTML()).not.toContain(SHT);
    });
  }

  test("chủ quản có quyền (Admin): nhóm SHT + đúng 4 link ngoài, href = contractsUrl + đường dẫn, cùng tab", async ({
    page,
  }) => {
    await page.goto("/#/feed");
    await as(page, "an");
    const g = page.getByTestId("nav-group-sht");
    await expect(g).toBeVisible();
    await expect(g).toContainText(SHT);
    const links = g.getByTestId("sht-link");
    await expect(links).toHaveCount(4);
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs).toEqual(SHT_PATHS);
    expect(await links.evaluateAll((els) => els.map((e) => e.getAttribute("target")))).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

test("topbar: brand công ty chủ quản (kể cả đối tác), không navtab / bánh răng / Đăng xuất riêng", async ({
  page,
}) => {
  await page.goto("/#/feed");
  for (const id of ["an", "tp"]) {
    await as(page, id);
    await expect(page.locator("header.top .brand")).toContainText("NITI");
    await expect(page.locator("header.top .navtab")).toHaveCount(0);
    await expect(page.locator('header.top [aria-label="Cài đặt"]')).toHaveCount(0);
    await expect(page.locator("header.top").getByRole("button", { name: "Đăng xuất" })).toHaveCount(
      0,
    );
  }
});

test("user-menu role=menu, Tường nhà mở hồ sơ mình, Esc đóng, sidebar xổ/gập nhớ qua tải lại", async ({
  page,
}) => {
  await page.goto("/#/feed");
  const avatar = page.getByRole("button", { name: "Tài khoản" });
  await avatar.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await avatar.click();
  await page.getByRole("menuitem", { name: "Tường nhà" }).click();
  await expect(page).toHaveURL(/#\/profile$/);

  // gập nhóm Community ⇒ chuyển trang vẫn gập ⇒ tải lại vẫn gập
  const head = page.getByRole("button", { name: "Community", exact: true });
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await page.goto("/#/feed");
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.getByRole("button", { name: "Community", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("#/settings = Bảng tin + hộp thoại; Esc đóng và giữ route nền", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
  await expect(page.getByTestId("composer")).toBeVisible(); // nền = Bảng tin
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/feed$/);
});

test("≤ 900 px / 375 px: sidebar là drawer mở bằng burger, đóng bằng nền; topbar không tràn", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/#/feed");
  const feedLink = page.locator("#shell-nav").getByRole("link", { name: "Bảng tin" });
  await expect(feedLink).toBeHidden();
  await page.getByRole("button", { name: "Mở menu" }).click();
  await expect(feedLink).toBeVisible();
  await page.locator(".scrim").click({ position: { x: 340, y: 400 } });
  await expect(feedLink).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
