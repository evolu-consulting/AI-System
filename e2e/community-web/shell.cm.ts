// CR-110 · COM-FR-27..31, 43 · CR-120 · e2e lớp vỏ community-web (adapter mock + persona switcher) trong MỘT AppShell dùng chung với Sổ Hợp Tác.
// Trọng tâm: cách ly đối tác (I1/I3, HT-75/76) — nhóm "Sổ Hợp Tác" và link contracts KHÔNG có trong DOM (không phải CSS ẩn); điều hướng
// trong app không tải lại trang; khung (menu trái, thanh trên, menu tài khoản, công tắc sáng/tối) dùng chung, không còn khung riêng của Community.
import { expect, type Page, test } from "@playwright/test";
import { HOST_ORG } from "../../apps/workspace-web/src/modules/community/adapters/seed";
import { spa } from "./_nav";

const as = async (page: Page, id: string) => {
  await page.getByLabel("Chọn nhân vật").selectOption(id);
};
const SHT = "Sổ Hợp Tác";
const SHT_PATHS = ["/contracts", "/contracts/list", "/contracts/partners", "/contracts/products"];

test.describe("cách ly đối tác: DOM không có Sổ Hợp Tác", () => {
  for (const [id, label] of [
    ["tp", "NCC (Tân Phát)"],
    ["abc", "người mua (ABC)"],
    ["cuong", "thành viên chủ quản không có quyền contracts"],
  ] as const) {
    test(`${label}: không nhóm SHT, không sht-link, không chữ "${SHT}" ở trang, user-menu và Cài đặt`, async ({
      page,
    }) => {
      await page.goto("/community");
      await as(page, id);
      await expect(page.getByTestId("nav-group-community")).toBeVisible();
      await expect(page.getByTestId("nav-group-contracts")).toHaveCount(0);
      await expect(page.locator('a[href^="/contracts"]')).toHaveCount(0);
      expect(await page.locator("body").innerHTML()).not.toContain(SHT);
      // user-menu + hộp thoại Cài đặt cũng sạch
      await page.getByRole("button", { name: "Tài khoản" }).click();
      expect(await page.locator("body").innerHTML()).not.toContain(SHT);
      await page.getByRole("menuitem", { name: "Cài đặt Community" }).click();
      await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
      expect(await page.locator("body").innerHTML()).not.toContain(SHT);
      await page.keyboard.press("Escape");
      // hồ sơ cũng không có link SHT
      await spa(page, "/community/profile"); // persona mock nằm trong bộ nhớ: goto sẽ tải lại ⇒ về persona mặc định (Admin có SHT)
      await expect(page.getByTestId("nav-group-contracts")).toHaveCount(0);
      expect(await page.locator("body").innerHTML()).not.toContain(SHT);
    });
  }

  test("chủ quản có quyền (Admin): nhóm SHT + đúng 4 link TRONG app (<Link>, không biểu tượng ngoài), href = đường dẫn contracts, cùng tab", async ({
    page,
  }) => {
    await page.goto("/community");
    await as(page, "an");
    const g = page.getByTestId("nav-group-contracts");
    await expect(g).toBeVisible();
    await expect(g).toContainText(SHT);
    const links = g.getByRole("link");
    await expect(links).toHaveCount(4);
    await expect(g.locator(".ext")).toHaveCount(0); // không còn biểu tượng liên kết ngoài ↗
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

test("topbar dùng chung: brand công ty chủ quản (kể cả đối tác), khe tìm + chuông của Community, không navtab / bánh răng / Đăng xuất riêng", async ({
  page,
}) => {
  await page.goto("/community");
  for (const id of ["an", "tp"]) {
    await as(page, id);
    await expect(page.getByTestId("shell-brand")).toContainText(HOST_ORG.name);
    const header = page.locator("header");
    await expect(header.getByRole("searchbox")).toBeVisible(); // ô tìm Community nằm trong thanh trên chung
    await expect(header.getByRole("button", { name: "Thông báo" })).toBeVisible();
    await expect(header.locator(".navtab")).toHaveCount(0);
    await expect(header.locator('[aria-label="Cài đặt"]')).toHaveCount(0);
    await expect(header.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0);
  }
});

test("MỘT khung: không còn header/sidebar riêng của Community; mục menu là <Link> (không onClick thô)", async ({
  page,
}) => {
  await page.goto("/community");
  await expect(page.locator("header.top")).toHaveCount(0);
  await expect(page.locator("#shell-nav")).toHaveCount(0);
  await expect(page.locator("a.sidelink")).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link", { name: "Bảng tin" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Bài đăng của tôi" })).toHaveAttribute(
    "href",
    "/community/profile",
  );
});

test("điều hướng trong app KHÔNG tải lại trang: Bảng tin ↔ Bài đăng của tôi, rồi sang Sổ Hợp Tác (không sự kiện load)", async ({
  page,
}) => {
  await page.goto("/community");
  await as(page, "an");
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await page.evaluate(() => {
    (window as unknown as { __noReload: number }).__noReload = 1;
    window.addEventListener("load", () => {
      (window as unknown as { __loaded: boolean }).__loaded = true;
    });
  });
  const navEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await nav.getByRole("link", { name: "Bài đăng của tôi" }).click();
  await expect(page).toHaveURL(/\/community\/profile$/);
  await nav.getByRole("link", { name: "Bảng tin" }).click();
  await expect(page).toHaveURL(/\/community$/);
  // sang Sổ Hợp Tác (mock không có phiên ⇒ router chuyển trong app tới /login; vẫn KHÔNG tải lại)
  await nav.getByRole("link", { name: "Hợp đồng & giao dịch" }).click();
  await expect(page).not.toHaveURL(/\/community/);
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(
    1,
  );
  expect(
    await page.evaluate(() => (window as unknown as { __loaded?: boolean }).__loaded),
  ).toBeUndefined();
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(
    navEntries,
  );
});

test("giao diện nằm TRONG menu tài khoản (chỉ biểu tượng Sáng/Tối/Theo máy, đổi html[data-theme]); không có nút sáng/tối riêng ở thanh trên", async ({
  page,
}) => {
  await page.goto("/community");
  await expect(page.locator("header").getByRole("button", { name: "Chế độ sáng/tối" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Tài khoản" }).click();
  const theme = page.getByRole("radiogroup", { name: "Giao diện" });
  await expect(theme.getByRole("radio")).toHaveCount(3);
  const dark = theme.getByRole("radio", { name: "Tối", exact: true });
  await expect(dark).toHaveText("");
  await dark.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(dark).toHaveAttribute("aria-checked", "true");
  await theme.getByRole("radio", { name: "Sáng", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("radiogroup", { name: "Ngôn ngữ" }).getByRole("radio")).toHaveText([
    "VI",
    "EN",
  ]);
});
test("3 loại bài có màu KHÁC nhau (nhãn, viền thẻ, nút soạn nhanh, đếm tab): bán ≠ mua ≠ thông báo", async ({
  page,
}) => {
  await page.goto("/community");
  await as(page, "an");
  const color = (sel: string, prop: "color" | "backgroundColor") =>
    page
      .locator(sel)
      .first()
      .evaluate((el, p) => getComputedStyle(el)[p as "color"], prop);
  const pills = [".pill.sell", ".pill.buy", ".pill.note"];
  const bg = await Promise.all(pills.map((s) => color(s, "backgroundColor")));
  const fg = await Promise.all(pills.map((s) => color(s, "color")));
  expect(new Set(bg).size).toBe(3);
  expect(new Set(fg).size).toBe(3);
  const icons = await Promise.all(
    [".ctype.sell svg", ".ctype.buy svg", ".ctype.note svg"].map((s) => color(s, "color")),
  );
  expect(new Set(icons).size).toBe(3);
  const counts = await Promise.all(
    ["sell", "buy", "note"].map((t) => color(`.tab[data-type="${t}"] .n`, "backgroundColor")),
  );
  expect(new Set(counts).size).toBe(3);
});

test("user-menu role=menu, Tường nhà mở hồ sơ mình, Esc đóng; mục menu trái 'Bài đăng của tôi' sáng", async ({
  page,
}) => {
  await page.goto("/community");
  const avatar = page.getByRole("button", { name: "Tài khoản" });
  await avatar.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await avatar.click();
  await page.getByRole("menuitem", { name: "Tường nhà" }).click();
  await expect(page).toHaveURL(/\/community\/profile$/);
  await expect(
    page
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Bài đăng của tôi" }),
  ).toHaveAttribute("aria-current", "page");
});

test("/community?settings=1 = Bảng tin + hộp thoại; Esc đóng và giữ route nền", async ({
  page,
}) => {
  await page.goto("/community?settings=1");
  await expect(page.getByRole("dialog", { name: "Cài đặt" })).toBeVisible();
  await expect(page.getByTestId("composer")).toBeVisible(); // nền = Bảng tin
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/community$/);
});

test("375 px: menu trái ẩn, thanh dưới có Bảng tin; thanh trên không tràn", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/community");
  await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeHidden();
  const bottom = page.getByRole("navigation", { name: "Điều hướng", exact: true });
  await expect(bottom.getByRole("link", { name: "Bảng tin" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
