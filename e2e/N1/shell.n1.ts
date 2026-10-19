// PK-FR-10 · D-02 · N1 plan-frontend §1 (Shell, Menu, Theme) §7 (nhãn Shell): layout và menu contracts-web — sidebar 4 mục, điều
// hướng, `/` → `/contracts`, `*` → `/contracts`, thanh dưới mobile, panel trợ lý (slot lazy), nút góp ý, đổi giao diện sáng/tối.
// So ảnh với mgmt-app (khung ±2 px, điểm ảnh) là việc của TF7 `e2e/contracts-web`. Backend giả `_support.ts`; không sleep.
import { expect, test } from "@playwright/test";
import { installBackend } from "./_support";

test.describe("PK-FR-10 · shell desktop (1440×900)", () => {
  test.beforeEach(async ({ page }) => {
    await installBackend(page, { session: true, role: "editor" });
  });

  test("PK-FR-10 · menu chính 4 mục đúng nhãn và đường dẫn: Hợp đồng /contracts · Đối tác /partners · So sánh giá /prices · Sản phẩm /cks", async ({
    page,
  }) => {
    await page.goto("/contracts");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    const hrefs: Record<string, string | null> = {};
    for (const name of ["Hợp đồng", "Đối tác", "So sánh giá", "Sản phẩm"]) {
      hrefs[name] = await nav.getByRole("link", { name }).getAttribute("href");
    }
    expect(hrefs).toEqual({
      "Hợp đồng": "/contracts",
      "Đối tác": "/partners",
      "So sánh giá": "/prices",
      "Sản phẩm": "/cks",
    });
  });

  test("PK-FR-10 · bấm menu đổi URL và đánh dấu mục đang chọn (aria-current)", async ({ page }) => {
    await page.goto("/contracts");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await nav.getByRole("link", { name: "Đối tác" }).click();
    await expect(page).toHaveURL(/\/partners$/);
    await expect(nav.getByRole("link", { name: "Đối tác" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Hợp đồng" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("PK-FR-10 · '/' ⇒ /contracts; đường dẫn lạ ⇒ /contracts (route *)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/contracts$/);
    await page.goto("/khong-ton-tai/abc");
    await expect(page).toHaveURL(/\/contracts$/);
  });

  test("PK-FR-10 · các route khung đều có (không 404 trắng): /contracts/new /partners /prices /cks /settings /settings/scoring", async ({
    page,
  }) => {
    for (const path of [
      "/contracts/new",
      "/partners",
      "/prices",
      "/cks",
      "/settings",
      "/settings/scoring",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
      await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    }
  });

  test("PK-FR-10 · tên app 'Sổ Hợp Tác' hiện trong shell (brand giữ nguyên mgmt-app)", async ({
    page,
  }) => {
    await page.goto("/contracts");
    // mgmt-app: sidebar thu gọn không hiện tên; rê chuột mở sidebar rồi mới thấy.
    await page.getByRole("navigation", { name: "Điều hướng chính" }).hover();
    await expect(page.getByText("Sổ Hợp Tác").first()).toBeVisible();
  });

  test("PK-FR-10 · panel trợ lý: 'Mở trợ lý AI' mở complementary 'Trợ lý AI'; 'Thu gọn ›' đóng; trạng thái nhớ sau reload (assistant:open)", async ({
    page,
  }) => {
    await page.goto("/contracts");
    const panel = page.getByRole("complementary", { name: "Trợ lý AI" });
    await expect(panel).toHaveCount(0);
    await page.getByRole("button", { name: "Mở trợ lý AI" }).click();
    await expect(panel).toBeVisible();
    await expect(page.getByRole("separator", { name: "Kéo để chỉnh rộng" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("complementary", { name: "Trợ lý AI" })).toBeVisible();
    await page.getByRole("button", { name: "Thu gọn ›" }).click();
    await expect(page.getByRole("complementary", { name: "Trợ lý AI" })).toHaveCount(0);
  });

  test("PK-FR-10 · panel trợ lý lazy: chưa mở thì không tải chunk 'assistant'", async ({
    page,
  }) => {
    const chunks: string[] = [];
    page.on("request", (r) => {
      if (/assistant/i.test(r.url()) && r.url().endsWith(".js")) chunks.push(r.url());
    });
    await page.goto("/contracts");
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    expect(chunks).toEqual([]);
  });

  test("PK-FR-10 · nút 'Góp ý về app' có trong header", async ({ page }) => {
    await page.goto("/contracts");
    await expect(page.getByRole("button", { name: "Góp ý về app" })).toBeVisible();
  });

  test("PK-FR-10 · chuông thông báo (khung S16) rỗng: mở ra thấy trạng thái rỗng, không lỗi", async ({
    page,
  }) => {
    await page.goto("/contracts");
    await page.getByRole("button", { name: /Thông báo/ }).click();
    await expect(page.getByRole("dialog").or(page.getByRole("menu"))).toBeVisible();
  });

  test("PK-FR-10 · giao diện: menu 'Tài khoản' có nhóm 'Giao diện' (radio ☾ Tối / ☀ Sáng) đổi html[data-theme] (D-02, như mgmt-app)", async ({
    page,
  }) => {
    await page.goto("/contracts");
    await expect(page.getByRole("button", { name: "Giao diện" })).toHaveCount(0);
    await page.getByRole("button", { name: /Tài khoản/ }).click();
    await page.getByRole("radio", { name: "☾ Tối" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "☀ Sáng" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("PK-FR-10 · shell mobile (390×844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("PK-FR-10 · thanh dưới 'Điều hướng' 4 mục; sidebar chính ẩn", async ({ page }) => {
    await installBackend(page, { session: true, role: "editor" });
    await page.goto("/contracts");
    const bottom = page.getByRole("navigation", { name: "Điều hướng", exact: true });
    await expect(bottom).toBeVisible();
    await expect(bottom.getByRole("link")).toHaveCount(4);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeHidden();
  });

  test("PK-FR-10 · không cuộn ngang trang (scrollWidth ≤ clientWidth) ở 390 px", async ({
    page,
  }) => {
    await installBackend(page, { session: true, role: "editor" });
    await page.goto("/contracts");
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });
});
