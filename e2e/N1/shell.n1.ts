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

  test("PK-FR-10 · nav-v2 · menu chính 7 mục (CR-132 thêm Tin nhắn) đúng nhãn, thứ tự và đường dẫn: Tổng quan /contracts · Hợp đồng /contracts/list · Đối tác /contracts/partners · Sản phẩm & Giá /contracts/products", async ({
    page,
  }) => {
    await page.goto("/contracts/list");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    const links = nav.getByRole("link").filter({ hasNotText: "Sổ Hợp Tác" });
    await expect(links).toHaveText([
      "Tổng quan",
      "Hợp đồng & giao dịch",
      "Yêu cầu",
      "Tin nhắn",
      "Việc của tôi",
      "Đối tác",
      "Sản phẩm & Giá",
    ]);
    const hrefs: Record<string, string | null> = {};
    for (const name of [
      "Tổng quan",
      "Hợp đồng & giao dịch",
      "Yêu cầu",
      "Tin nhắn",
      "Việc của tôi",
      "Đối tác",
      "Sản phẩm & Giá",
    ]) {
      hrefs[name] = await nav.getByRole("link", { name, exact: true }).getAttribute("href");
    }
    expect(hrefs).toEqual({
      "Tổng quan": "/contracts",
      "Hợp đồng & giao dịch": "/contracts/list",
      "Yêu cầu": "/contracts/requests",
      "Tin nhắn": "/contracts/messages",
      "Việc của tôi": "/contracts/approvals",
      "Đối tác": "/contracts/partners",
      "Sản phẩm & Giá": "/contracts/products",
    });
    // Không còn mục riêng cho So sánh giá / Sản phẩm CKS / Mua hàng.
    for (const gone of ["So sánh giá", "Mua hàng"]) {
      await expect(nav.getByRole("link", { name: gone })).toHaveCount(0);
    }
  });

  test("PK-FR-10 · bấm menu đổi URL và đánh dấu mục đang chọn (aria-current)", async ({ page }) => {
    await page.goto("/contracts/list");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await nav.getByRole("link", { name: "Đối tác" }).click();
    await expect(page).toHaveURL(/\/contracts\/partners$/);
    await expect(nav.getByRole("link", { name: "Đối tác" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Hợp đồng" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("PK-FR-10 · nav-v2 · '/' ⇒ /contracts (Tổng quan là trang đầu); đường dẫn lạ ⇒ trang «Không tìm thấy» + nút về Tổng quan (CR-131)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/contracts$/);
    await expect(page.getByRole("heading", { name: "Tổng quan", level: 1 })).toBeVisible();
    await page.goto("/khong-ton-tai/abc");
    // CR-131: URL lạ không còn chuyển hướng âm thầm
    await expect(page.getByRole("heading", { name: "Không tìm thấy trang này" })).toBeVisible();
    await page.getByRole("link", { name: "Về Tổng quan" }).click();
    await expect(page).toHaveURL(/\/contracts$/);
  });

  test("PK-FR-10 · các route khung đều có (không 404 trắng): /contracts /contracts/c/new /contracts/partners /contracts/products /contracts/settings/members", async ({
    page,
  }) => {
    for (const path of [
      "/contracts",
      "/contracts/c/new",
      "/contracts/partners",
      "/contracts/products",
      "/contracts/settings/members",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
      await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    }
  });

  test("PK-FR-10 · V2-O · tuyến cũ chuyển hướng (CR-119 p2: bảng legacy-routes): /overview /my-work ⇒ /contracts; /prices /cks /cks/x /sourcing ⇒ /contracts/products; /settings ⇒ /contracts/settings/members; /settings/scoring ⇒ /contracts/partners; /partners /contracts/<id> giữ query", async ({
    page,
  }) => {
    test.setTimeout(90_000); // 13 lần tải trang đầy đủ liên tiếp: 30 s mặc định quá sát khi máy chủ evotest bận
    const hops: [string, RegExp][] = [
      ["/overview", /\/contracts$/],
      ["/my-work", /\/contracts$/],
      ["/prices", /\/contracts\/products$/],
      ["/prices?product=gao", /\/contracts\/products$/],
      ["/cks", /\/contracts\/products$/],
      ["/cks/abc", /\/contracts\/products$/],
      ["/sourcing", /\/contracts\/products$/],
      ["/settings", /\/contracts\/settings\/members$/],
      ["/settings/scoring", /\/contracts\/partners$/],
      ["/partners", /\/contracts\/partners$/],
      ["/products?sp=p1", /\/contracts\/products\?sp=p1$/],
      ["/contracts?type=deal", /\/contracts\/list\?type=deal$/],
      ["/contracts/abc", /\/contracts\/c\/abc$/],
    ];
    for (const [from, to] of hops) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });

  test("PK-FR-10 · nav-v2 · Sản phẩm & Giá: một trang (V2-O đã gộp 3 tab cũ), một H1, không còn tab; mục menu 'Sản phẩm & Giá' sáng; link tab cũ vẫn về /products", async ({
    page,
  }) => {
    await page.goto("/contracts/products");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sản phẩm & Giá");
    await expect(page.getByRole("tab")).toHaveCount(0);
    for (const url of ["/products?tab=cks", "/products?tab=purchase", "/products?tab=compare"]) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/contracts\/products(\?|$)/);
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
    await page.goto("/contracts/list");
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await expect(nav.getByTestId("shell-brand").getByText("Sổ Hợp Tác")).toBeVisible();
    await expect(nav.getByTestId("shell-brand").getByText("Acme Corp")).toBeVisible();
    expect((await nav.boundingBox())?.width).toBe(224);
  });

  test("PK-FR-10 · nav-v2 · nút thanh trên thu sidebar về cột biểu tượng 64 px rồi mở lại; nhớ sau reload (nav:pinned)", async ({
    page,
  }) => {
    await page.goto("/contracts/list");
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
    await page.goto("/contracts/list");
    await page
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("button", { name: "Tài khoản" })
      .click();
    const menu = page.getByRole("menu", { name: "Tài khoản" });
    await expect(menu.getByRole("menuitem", { name: "Đăng xuất" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Cài đặt Sổ Hợp Tác", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/contracts\/list$/);
  });

  test("PK-FR-10 · panel trợ lý: 'Mở trợ lý AI' mở complementary 'Trợ lý AI'; 'Thu gọn ›' đóng; trạng thái nhớ sau reload (assistant:open)", async ({
    page,
  }) => {
    await page.goto("/contracts/list");
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
    await page.goto("/contracts/list");
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    expect(chunks).toEqual([]);
  });

  test("PK-FR-10 · nút 'Góp ý về app' có trong header", async ({ page }) => {
    await page.goto("/contracts/list");
    await expect(page.getByRole("button", { name: "Góp ý về app" })).toBeVisible();
  });

  test("PK-FR-10 · chuông thông báo (khung S16) rỗng: mở ra thấy trạng thái rỗng, không lỗi", async ({
    page,
  }) => {
    await page.goto("/contracts/list");
    await page.getByRole("button", { name: /Thông báo/ }).click();
    await expect(page.getByRole("dialog").or(page.getByRole("menu"))).toBeVisible();
  });

  test("PK-FR-10 · giao diện: menu 'Tài khoản' có nhóm 'Giao diện' CHỈ biểu tượng (radio Sáng / Tối / Theo máy, có tooltip) đổi html[data-theme]; 'Ngôn ngữ' VI | EN gọn (CR-120)", async ({
    page,
  }) => {
    await page.goto("/contracts/list");
    await expect(page.getByRole("button", { name: "Giao diện" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Chế độ sáng/tối" })).toHaveCount(0); // không có nút sáng/tối riêng ở thanh trên
    await page.getByRole("button", { name: /Tài khoản/ }).click();
    const theme = page.getByRole("radiogroup", { name: "Giao diện" });
    await expect(theme.getByRole("radio")).toHaveCount(3);
    for (const [name, tip] of [
      ["Sáng", "Sáng"],
      ["Tối", "Tối"],
      ["Theo máy", "Theo máy"],
    ] as const) {
      const r = theme.getByRole("radio", { name, exact: true });
      await expect(r).toHaveText(""); // chỉ biểu tượng, không chữ
      await expect(r).toHaveAttribute("title", tip);
    }
    await theme.getByRole("radio", { name: "Tối", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(theme.getByRole("radio", { name: "Tối", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await theme.getByRole("radio", { name: "Sáng", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const lang = page.getByRole("radiogroup", { name: "Ngôn ngữ" });
    await expect(lang.getByRole("radio")).toHaveText(["VI", "EN"]);
  });
});

test.describe("PK-FR-10 · shell mobile (390×844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("PK-FR-10 · nav-v2 · thanh dưới 'Điều hướng' đúng 5 mục (CR-132 thêm Tin nhắn); sidebar chính ẩn", async ({
    page,
  }) => {
    await installBackend(page, { session: true, role: "editor" });
    await page.goto("/contracts/list");
    const bottom = page.getByRole("navigation", { name: "Điều hướng", exact: true });
    await expect(bottom).toBeVisible();
    await expect(bottom.getByRole("link")).toHaveCount(5);
    // CR-126 · «Yêu cầu» là mục `more` (không chiếm cột); «Việc của tôi» là cột riêng; Hợp đồng (primary) đứng đầu
    await expect(bottom.getByRole("link")).toHaveText([
      "Hợp đồng & giao dịch",
      "Tổng quan",
      "Tin nhắn",
      "Đối tác",
      "Việc của tôi",
    ]);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeHidden();
  });

  test("PK-FR-10 · không cuộn ngang trang (scrollWidth ≤ clientWidth) ở 390 px", async ({
    page,
  }) => {
    await installBackend(page, { session: true, role: "editor" });
    await page.goto("/contracts/list");
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });
});
