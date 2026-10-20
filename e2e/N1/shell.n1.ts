// PK-FR-10 · D-02 · N1 plan-frontend §1 (Shell, Menu, Theme) §7 (nhãn Shell): layout và menu contracts-web — sidebar 4 mục, điều
// hướng, `/` → `/overview`, `*` → `/contracts`, thanh dưới mobile, panel trợ lý (slot lazy), nút góp ý, đổi giao diện sáng/tối.
// nav-v2 (người dùng chốt 2026-10-20, thay D-02 "giống hệt mgmt-app" cho điều hướng): menu Tổng quan · Hợp đồng · Đối tác · Sản phẩm & Giá,
// tuyến cũ chuyển hướng, menu avatar. Ảnh/khung theo baseline mới ở `e2e/contracts-web`. Backend giả `_support.ts`; không sleep.
import { expect, test } from "@playwright/test";
import { installBackend } from "./_support";

test.describe("PK-FR-10 · shell desktop (1440×900)", () => {
  test.beforeEach(async ({ page }) => {
    await installBackend(page, { session: true, role: "editor" });
  });

  test("PK-FR-10 · nav-v2 · menu chính 4 mục đúng nhãn, thứ tự và đường dẫn: Tổng quan /overview · Hợp đồng /contracts · Đối tác /partners · Sản phẩm & Giá /products", async ({
    page,
  }) => {
    await page.goto("/contracts");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    const links = nav.getByRole("link").filter({ hasNotText: "Sổ Hợp Tác" });
    await expect(links).toHaveText(["Tổng quan", "Hợp đồng", "Đối tác", "Sản phẩm & Giá"]);
    const hrefs: Record<string, string | null> = {};
    for (const name of ["Tổng quan", "Hợp đồng", "Đối tác", "Sản phẩm & Giá"]) {
      hrefs[name] = await nav.getByRole("link", { name, exact: true }).getAttribute("href");
    }
    expect(hrefs).toEqual({
      "Tổng quan": "/overview",
      "Hợp đồng": "/contracts",
      "Đối tác": "/partners",
      "Sản phẩm & Giá": "/products",
    });
    // Không còn mục riêng cho So sánh giá / Sản phẩm CKS / Mua hàng / Việc của tôi.
    for (const gone of ["So sánh giá", "Mua hàng", "Việc của tôi"]) {
      await expect(nav.getByRole("link", { name: gone })).toHaveCount(0);
    }
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

  test("PK-FR-10 · nav-v2 · '/' ⇒ /overview (Tổng quan là trang đầu); đường dẫn lạ ⇒ /contracts (route *)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole("heading", { name: "Tổng quan", level: 1 })).toBeVisible();
    await page.goto("/khong-ton-tai/abc");
    await expect(page).toHaveURL(/\/contracts$/);
  });

  test("PK-FR-10 · các route khung đều có (không 404 trắng): /overview /contracts/new /partners /products /settings/members", async ({
    page,
  }) => {
    for (const path of [
      "/overview",
      "/contracts/new",
      "/partners",
      "/products",
      "/settings/members",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
      await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    }
  });

  test("PK-FR-10 · V2-O · tuyến cũ chuyển hướng: /my-work ⇒ /overview; /prices /cks /cks/x /sourcing ⇒ /products; /settings ⇒ /settings/members; /settings/scoring ⇒ /partners", async ({
    page,
  }) => {
    const hops: [string, RegExp][] = [
      ["/my-work", /\/overview$/],
      ["/prices", /\/products$/],
      ["/prices?product=gao", /\/products$/],
      ["/cks", /\/products$/],
      ["/cks/abc", /\/products$/],
      ["/sourcing", /\/products$/],
      ["/settings", /\/settings\/members$/],
      ["/settings/scoring", /\/partners$/],
    ];
    for (const [from, to] of hops) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });

  test("PK-FR-10 · nav-v2 · Sản phẩm & Giá: 3 tab So sánh giá · Sản phẩm CKS · Mua hàng; một H1; mục menu 'Sản phẩm & Giá' sáng ở mọi tab", async ({
    page,
  }) => {
    await page.goto("/products");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sản phẩm & Giá");
    await expect(page.getByRole("tab")).toHaveText(["So sánh giá", "Sản phẩm CKS", "Mua hàng"]);
    for (const tab of ["Sản phẩm CKS", "Mua hàng", "So sánh giá"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await expect(nav.getByRole("link", { name: "Sản phẩm & Giá" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    }
  });

  test("PK-FR-10 · nav-v2 · tên app + tên công ty hiện sẵn ở đầu sidebar (ghim mở 224 px, không cần rê chuột)", async ({
    page,
  }) => {
    await page.goto("/contracts");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await expect(nav.getByText("Sổ Hợp Tác")).toBeVisible();
    await expect(nav.getByText("Acme Corp").first()).toBeVisible();
    expect((await nav.boundingBox())?.width).toBe(224);
  });

  test("PK-FR-10 · nav-v2 · nút thanh trên thu sidebar về cột biểu tượng 64 px rồi mở lại; nhớ sau reload (nav:pinned)", async ({
    page,
  }) => {
    await page.goto("/contracts");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await page.getByRole("button", { name: "Thu gọn thanh bên" }).click();
    await expect.poll(async () => (await nav.boundingBox())?.width).toBe(64);
    await expect(nav.getByText("Sổ Hợp Tác")).toHaveCount(0);
    await page.reload();
    await expect.poll(async () => (await nav.boundingBox())?.width).toBe(64);
    await page.getByRole("button", { name: "Mở rộng thanh bên" }).click();
    await expect.poll(async () => (await nav.boundingBox())?.width).toBe(224);
  });

  test("PK-FR-10 · nav-v2 · avatar ở chân sidebar mở menu có 'Cài đặt' (mở hộp thoại, không đổi trang) và 'Đăng xuất'", async ({
    page,
  }) => {
    await page.goto("/contracts");
    await page
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("button", { name: "Tài khoản" })
      .click();
    const menu = page.getByRole("menu", { name: "Tài khoản" });
    await expect(menu.getByRole("menuitem", { name: "Đăng xuất" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Cài đặt", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/contracts$/);
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

  test("PK-FR-10 · nav-v2 · thanh dưới 'Điều hướng' đúng 4 mục như menu trái; sidebar chính ẩn", async ({
    page,
  }) => {
    await installBackend(page, { session: true, role: "editor" });
    await page.goto("/contracts");
    const bottom = page.getByRole("navigation", { name: "Điều hướng", exact: true });
    await expect(bottom).toBeVisible();
    await expect(bottom.getByRole("link")).toHaveCount(4);
    await expect(bottom.getByRole("link")).toHaveText([
      "Tổng quan",
      "Hợp đồng",
      "Đối tác",
      "Sản phẩm & Giá",
    ]);
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
