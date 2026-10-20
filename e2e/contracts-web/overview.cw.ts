// nav-v2 (người dùng chốt 2026-10-20) · Tổng quan `/overview` · Luật 4b: trang đầu (`/` ⇒ /overview), «Cần xử lý» (6 việc + «Xem thêm»),
// «Hợp đồng» (số theo nhóm trạng thái + HĐ sắp hết hiệu lực), «Đối tác cần xem lại» (mức CHÚ Ý); khối cần số liệu mới (kết quả kinh doanh,
// gợi ý sản phẩm) CHƯA hiện. Dữ liệu chỉ lấy từ API sẵn có và tôn trọng quyền xem (API tự lọc). Backend giả `page.route`; không sleep.
// Cảnh ảnh của trang: `scenes.cw.ts` (overview-*). Nút hành động trên từng việc: `mywork.cw.ts`.
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { facetsAsHub } from "./dataset-list";
import { contractsListAsHub, myWorkAsHub, partnersForOverview, WORK } from "./dataset-overview";

test.skip(process.env.CW_MODE === "capture", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, code: number, body: unknown) =>
  r.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });

type Opts = { role?: Role; work?: unknown[]; partners?: unknown[]; expiring?: boolean };
async function install(page: Page, o: Opts = {}) {
  const d = asHub(o.role ?? "editor");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/my-work", (r) => json(r, 200, myWorkAsHub(o.work)));
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts/facets",
    (r) => json(r, 200, facetsAsHub()),
  );
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts",
    (r) => {
      const q = new URL(r.request().url()).searchParams;
      if (o.expiring === false)
        return json(r, 200, { items: [], total: 0, parents: [], page: 1, page_size: 3 });
      return json(r, 200, contractsListAsHub(q));
    },
  );
  await page.route(
    (u) => u.pathname === "/pack/contracts/partners",
    (r) => json(r, 200, o.partners ?? partnersForOverview(new URL(r.request().url()).searchParams)),
  );
}

test("«/» ⇒ /overview: H1 Tổng quan, ngày theo máy chủ, mục menu «Tổng quan» sáng", async ({
  page,
}) => {
  await install(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/overview$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Tổng quan", level: 1 })).toBeVisible();
  await expect(main.getByText("Hôm nay 18/10/2026")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Tổng quan" }),
  ).toHaveAttribute("aria-current", "page");
});

test("khối cần số liệu mới (kết quả kinh doanh, gợi ý sản phẩm) chưa hiện — không placeholder", async ({
  page,
}) => {
  await install(page);
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "Cần xử lý", level: 2 })).toBeVisible();
  const main = page.getByRole("main");
  for (const hidden of [
    "Doanh thu",
    "Lãi gộp",
    "Hoa hồng",
    "Hàng đang giữ",
    "nên làm gì",
    "Giao dịch nhiều nhất",
  ]) {
    await expect(main.getByText(hidden)).toHaveCount(0);
  }
});

test("«Cần xử lý»: 8 việc ⇒ hiện 6 + «Xem thêm 2 việc»; mở ra đủ 8, «Thu gọn» về 6; đếm quá hạn", async ({
  page,
}) => {
  await install(page);
  await page.goto("/overview");
  await expect(page.getByText("8 việc · 2 quá hạn")).toBeVisible();
  await expect(page.getByTestId("work-row")).toHaveCount(6);
  await expect(page.getByTestId("work-row").first()).toContainText("Thu tiền Khách An");
  const more = page.getByRole("button", { name: "Xem thêm 2 việc" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(page.getByTestId("work-row")).toHaveCount(8);
  await page.getByRole("button", { name: "Thu gọn", exact: true }).click();
  await expect(page.getByTestId("work-row")).toHaveCount(6);
});

test("«Cần xử lý»: đúng 6 việc ⇒ không có «Xem thêm»", async ({ page }) => {
  await install(page, { work: WORK.slice(0, 6) });
  await page.goto("/overview");
  await expect(page.getByTestId("work-row")).toHaveCount(6);
  await expect(page.getByRole("button", { name: /^Xem thêm/ })).toHaveCount(0);
});

test("«Hợp đồng»: 3 hợp đồng theo nhóm (chờ xác nhận 1 · đang hiệu lực 2 · đã xử lý 0) + HĐ sắp hết hiệu lực còn 33 ngày", async ({
  page,
}) => {
  await install(page);
  await page.goto("/overview");
  await expect(page.getByText("3 hợp đồng")).toBeVisible();
  const tile = (g: string) => page.locator(`[data-group="${g}"]`);
  await expect(tile("pending")).toContainText("1");
  await expect(tile("pending")).toContainText("Chờ xác nhận");
  await expect(tile("active")).toContainText("2");
  await expect(tile("active")).toContainText("Đang hiệu lực");
  await expect(tile("done")).toContainText("0");
  const soon = page.getByTestId("expiring-list");
  await expect(soon).toContainText("Hợp đồng vận chuyển quý 4");
  await expect(soon).toContainText("33 ngày");
  await soon.getByRole("link", { name: "Hợp đồng vận chuyển quý 4" }).click();
  await expect(page).toHaveURL(/\/contracts\/c1000000-0000-4000-8000-000000000013$/);
});

test("«Hợp đồng»: không có HĐ sắp hết hiệu lực ⇒ thông báo; «Xem tất cả hợp đồng» ⇒ /contracts", async ({
  page,
}) => {
  await install(page, { expiring: false });
  await page.goto("/overview");
  await expect(page.getByText("Không có hợp đồng sắp hết hiệu lực.")).toBeVisible();
  await page.getByRole("link", { name: "Xem tất cả hợp đồng" }).click();
  await expect(page).toHaveURL(/\/contracts$/);
});

test("«Đối tác cần xem lại»: chỉ đối tác mức CHÚ Ý; mức khác không hiện", async ({ page }) => {
  await install(page);
  await page.goto("/overview");
  const list = page.getByTestId("review-partners");
  await expect(list).toContainText("Bếp Việt");
  await expect(list).toContainText("CHÚ Ý");
  await expect(list).not.toContainText("Kế toán Phương Nam"); // mức TỐT
  await expect(list).not.toContainText("VPP Hồng Hà"); // chưa có điểm
  await expect(list.getByRole("listitem")).toHaveCount(1);
});

test("«Đối tác cần xem lại»: API không trả đối tác nào (không có quyền xem / không ai ở mức CHÚ Ý) ⇒ thông báo, không rò rỉ", async ({
  page,
}) => {
  await install(page, { partners: [] });
  await page.goto("/overview");
  await expect(page.getByText("Không có đối tác ở mức CHÚ Ý.")).toBeVisible();
  await expect(page.getByTestId("review-partners")).toHaveCount(0);
});

test("người xem (viewer): thấy cùng dữ liệu API trả, không có nút ghi sổ/HĐ", async ({ page }) => {
  await install(page, { role: "viewer" });
  await page.goto("/overview");
  await expect(page.getByTestId("work-row")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Đã thu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Đã trả" })).toHaveCount(0);
});

test.describe("điện thoại (390×844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Tổng quan không cuộn ngang; thanh dưới đúng 4 mục, «Tổng quan» sáng", async ({ page }) => {
    await install(page);
    await page.goto("/overview");
    await expect(page.getByTestId("review-partners")).toBeVisible();
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    const bottom = page.getByRole("navigation", { name: "Điều hướng", exact: true });
    await expect(bottom.getByRole("link")).toHaveText([
      "Tổng quan",
      "Hợp đồng",
      "Đối tác",
      "Sản phẩm & Giá",
    ]);
    await expect(bottom.getByRole("link", { name: "Tổng quan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
