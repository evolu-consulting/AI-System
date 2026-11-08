// CR-121 C-5 · thanh trái MỘT component: Community → Sổ Hợp Tác giữ nguyên cùng <nav data-testid="shell-sidebar">, mục đang chọn đúng.
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "../contracts-web/dataset";

// Bản build mock Community không có phiên; sang Sổ Hợp Tác (`_authed`) cần phiên ⇒ giả `/auth/refresh` + `/pack/contracts/me` như e2e contracts-web
// (không có thì router chuyển tới /login và thanh trái biến mất). Trang `/community*` không dùng phiên nên không đổi.
async function signedIn(page: Page) {
  const d = asHub("editor");
  await page.route("**/auth/refresh", (r) => r.fulfill({ json: d.grant }));
  await page.route("**/pack/contracts/me", (r) => r.fulfill({ json: d.packMe }));
}

test("Community → Sổ Hợp Tác: cùng một thanh trái (shell-sidebar), mục đang chọn đổi đúng, không có thanh trái thứ hai", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/community");
  await page.getByLabel("Chọn nhân vật").selectOption("an");
  const side = page.getByTestId("shell-sidebar");
  await expect(side).toHaveCount(1);
  await side.evaluate((el) => {
    (el as HTMLElement & { __same?: boolean }).__same = true;
  });
  await expect(side.locator('[data-nav-item="/community"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(side.locator('[data-nav-item="/contracts"]')).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await side.locator('[data-nav-item="/contracts/list"]').click();
  // CR-121 C-8 · ngay lúc bấm (trang đích còn tải lười): chỉ MỘT mục aria-current (mục đích) và khe tìm của Community đã ẩn
  // chỉ tính MỤC MENU (`data-nav-item`): liên kết thương hiệu đầu thanh trái (`/contracts`) do router đặt aria-current theo tiền tố, không phải mục menu
  await expect(side.locator("[data-nav-item][aria-current]")).toHaveCount(1);
  await expect(side.locator('[data-nav-item="/contracts/list"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("topbar-search")).toBeHidden();
  await expect(page).toHaveURL(/\/contracts/);
  const after = page.getByTestId("shell-sidebar");
  await expect(after).toHaveCount(1);
  expect(await after.evaluate((el) => (el as HTMLElement & { __same?: boolean }).__same)).toBe(
    true,
  ); // cùng nút DOM, không dựng lại thanh trái
  await expect(after.locator('[data-nav-item="/contracts/list"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(after.locator('[data-nav-item="/community"]')).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("aside.rail nav, nav.sidenav")).toHaveCount(0);
});

// CR-121 C-7 · mục hàng việc có badge số (0 ⇒ không có, trên 99 ⇒ "99+") ở cả hai app + mục "Chờ tôi duyệt" của Sổ Hợp Tác
// (chỉ khi server báo có vai duyệt) + trang rỗng nói rõ lý do/bước kế. Số do server tính — test giả lập MỘT phản hồi `GET /pack/nav`.
test("Menu: badge số cho Duyệt bài / Yêu cầu tham gia / Chờ tôi duyệt; 0 ẩn, >99 hiện 99+; trang Chờ tôi duyệt rỗng có hướng dẫn", async ({
  page,
}) => {
  const items = [
    { cap: "community.review", count: 3 },
    { cap: "community.join", count: 120 },
    { cap: "community.reports", count: 0 },
    { cap: "contracts.review", count: 2 },
  ];
  await signedIn(page);
  await page.route("**/pack/nav", (r) => r.fulfill({ json: { items } }));
  await page.route("**/pack/contracts/my-work", (r) =>
    r.fulfill({ json: { followups: [], approvals: [] } }),
  );
  // CR-126 · hộp việc đọc thêm `GET /me/review-tasks` (bước yêu cầu/quy trình): rỗng
  await page.route("**/me/review-tasks*", (r) =>
    r.fulfill({ json: { items: [], open_count: 0, next_cursor: null } }),
  );
  await page.goto("/community");
  await page.getByLabel("Chọn nhân vật").selectOption("an");
  const side = page.getByTestId("shell-sidebar");
  const badge = (to: string) => side.locator(`[data-nav-item="${to}"] [data-testid="nav-badge"]`);
  await expect(badge("/community/review")).toHaveText("3");
  await expect(badge("/community/join")).toHaveText("99+");
  await expect(badge("/community/reports")).toHaveCount(0); // 0 ⇒ không hiện badge
  // CR-126 · số «Việc của tôi» đếm ở máy khách (my-work + review-tasks), không còn theo `contracts.review` ⇒ không việc = không badge
  await expect(badge("/contracts/approvals")).toHaveCount(0);
  // badge 16 px, cùng kiểu chuông Header
  const h = await badge("/community/review").evaluate((el) =>
    Math.round(el.getBoundingClientRect().height),
  );
  expect(h).toBe(16);
  // trang Chờ tôi duyệt: rỗng ⇒ câu giải thích + bước kế
  await side.locator('[data-nav-item="/contracts/approvals"]').click();
  await expect(page).toHaveURL(/\/contracts\/approvals/);
  await expect(page.getByTestId("approvals-empty")).toContainText("Hiện không có việc nào chờ bạn");
  await expect(page.getByTestId("approvals-empty").getByRole("link")).toHaveText(
    "Xem tất cả hợp đồng",
  );
  // CR-126 · «Việc của tôi» luôn hiện (không phụ thuộc vai duyệt)
  await page.unroute("**/pack/nav");
  await page.route("**/pack/nav", (r) =>
    r.fulfill({ json: { items: items.filter((i) => i.cap !== "contracts.review") } }),
  );
  await page.reload();
  await expect(side.locator('[data-nav-item="/contracts/list"]')).toBeVisible(); // thanh trái đã dựng lại
  await expect(side.locator('[data-nav-item="/contracts/approvals"]')).toBeVisible();
});

// CR-121 C-6 · cùng khung nhìn: biểu tượng menu cùng cỡ, cụm nút Header cùng testid, một nút trợ lý (assistant-fab) ở cả hai module.
test("Community và Sổ Hợp Tác: icon menu cùng cỡ, cụm nút Header cùng testid, nút trợ lý cùng testid", async ({
  page,
}) => {
  await signedIn(page);
  const iconBox = async () =>
    page
      .getByTestId("shell-sidebar")
      .locator("[data-nav-item] svg")
      .first()
      .evaluate((el) => {
        const r = (el as SVGElement).getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          sw: el.getAttribute("stroke-width"),
        };
      });
  await page.goto("/community");
  await page.getByLabel("Chọn nhân vật").selectOption("an");
  const cm = await iconBox();
  await expect(page.getByTestId("topbar-actions")).toHaveCount(1);
  await expect(page.getByTestId("topbar-bell")).toHaveCount(1);
  await expect(page.getByTestId("topbar-search")).toHaveCount(1);
  await expect(page.getByTestId("assistant-fab")).toHaveCount(1);
  await page.getByTestId("shell-sidebar").locator('[data-nav-item="/contracts/list"]').click();
  await expect(page).toHaveURL(/\/contracts/);
  const ct = await iconBox();
  expect(cm).toEqual({ w: 20, h: 20, sw: "1.8" });
  expect(ct).toEqual(cm);
  await expect(page.getByTestId("topbar-actions")).toHaveCount(1);
  await expect(page.getByTestId("topbar-bell")).toHaveCount(1);
  await expect(page.getByTestId("topbar-search")).toHaveCount(1);
  await expect(page.getByTestId("assistant-fab")).toHaveCount(1);
  // tooltip nhãn khi di chuột
  await page.getByTestId("assistant-fab").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Hỏi trợ lý AI");
});
