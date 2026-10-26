// nav-v2 + V2-N · Tổng quan `/overview`: 4 con số + chọn kỳ (`GET /overview`), «Cần xử lý» (`GET /my-work/todo`: 6 việc + «Xem thêm», Bỏ qua / Đã xong),
// theo nhóm SP, «Hợp đồng», «Đối tác cần xem lại», «Sản phẩm: nên làm gì» (điểm kinh doanh), «Giao dịch nhiều nhất». Backend giả `page.route`; không sleep.
// Cảnh ảnh của trang: `scenes.cw.ts` (overview-*).
import { expect, type Page, type Route, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { facetsAsHub } from "./dataset-list";
import {
  bizListAsHub,
  contractsListAsHub,
  overviewAsHub,
  partnersForOverview,
  TODO,
  todoAsHub,
} from "./dataset-overview";

test.skip(process.env.CW_MODE === "capture", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, code: number, body: unknown) =>
  r.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });

type Opts = {
  role?: Role;
  work?: unknown[];
  partners?: unknown[];
  expiring?: boolean;
  dismissed?: unknown[];
};
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
  await page.route("**/pack/contracts/my-work/todo", (r) => json(r, 200, todoAsHub(o.work)));
  await page.route("**/pack/contracts/my-work/todo/dismiss", (r) => {
    o.dismissed?.push(r.request().postDataJSON());
    return json(r, 200, { ok: true });
  });
  await page.route("**/pack/contracts/overview?*", (r) =>
    json(r, 200, overviewAsHub(new URL(r.request().url()).searchParams.get("period") ?? "month")),
  );
  await page.route("**/pack/contracts/business/products", (r) => json(r, 200, bizListAsHub()));
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
    (r) => {
      const q = new URL(r.request().url()).searchParams;
      // U3: Tổng quan đọc `GET /partners?role=` (engine HD8); bộ ghi đè `o.partners` lọc theo vai như máy chủ.
      const rows = o.partners
        ? (o.partners as { role: string }[]).filter(
            (x) => !q.get("role") || x.role === q.get("role"),
          )
        : partnersForOverview(q);
      return json(r, 200, rows);
    },
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

test("4 con số: doanh thu/hoa hồng thực nhận + % dự kiến + so kỳ trước, lãi gộp có biên, hàng đang giữ", async ({
  page,
}) => {
  await install(page);
  await page.goto("/overview");
  const kpis = page.getByTestId("kpis");
  await expect(kpis).toContainText("Doanh thu thực nhận");
  await expect(kpis).toContainText("118,0 tr");
  await expect(kpis).toContainText("50% của dự kiến");
  await expect(kpis).toContainText("chưa thu 118,0 tr");
  await expect(kpis).toContainText("▲ 18%");
  await expect(kpis).toContainText("Lãi gộp");
  await expect(kpis).toContainText("biên 22% trên doanh thu dự kiến");
  await expect(kpis).toContainText("▼ 13%");
  await expect(kpis).toContainText("Hoa hồng thực nhận");
  await expect(kpis).toContainText("Hàng đang giữ");
  await expect(kpis).toContainText("1,25 tỷ");
});

test("chọn kỳ: Quý này ⇒ gọi lại /overview?period=quarter", async ({ page }) => {
  await install(page);
  await page.goto("/overview");
  const req = page.waitForRequest((r) => r.url().includes("/overview?period=quarter"));
  await page.locator('[data-period="quarter"]').click();
  await req;
  await expect(page.locator('[data-period="quarter"]')).toHaveAttribute("aria-pressed", "true");
});

test("«Theo nhóm sản phẩm»: 3 nhóm, mỗi nhóm 12 cột tháng", async ({ page }) => {
  await install(page);
  await page.goto("/overview");
  const groups = page.getByTestId("groups");
  for (const g of ["service", "goods", "referral"]) {
    await expect(groups.locator(`[data-group="${g}"] [role="img"] > span`)).toHaveCount(12);
  }
  await expect(groups.locator('[data-group="goods"]')).toContainText("146,0 tr");
});

test("«Sản phẩm: nên làm gì»: 3 cột theo đề xuất, SP chưa có điểm không hiện; «Giao dịch nhiều nhất» có 2 vai", async ({
  page,
}) => {
  await install(page);
  await page.goto("/overview");
  const recs = page.getByTestId("recs");
  await expect(recs.locator('[data-col="buy"]')).toContainText("Chữ ký số 1 năm");
  await expect(recs.locator('[data-col="buy"]')).toContainText("Token USB");
  await expect(recs.locator('[data-col="hold"]')).toContainText("Hoá đơn điện tử");
  await expect(recs.locator('[data-col="dump"]')).toContainText("Phần mềm kế toán");
  await expect(recs).not.toContainText("SP mới");
  const top = page.getByTestId("top-partners");
  await expect(top.locator('[data-role="supplier"]')).toBeVisible();
  await expect(top.locator('[data-role="customer"]')).toBeVisible();
});

test("«Cần xử lý»: Bỏ qua gửi khoá việc (POST /my-work/todo/dismiss) rồi tải lại danh sách", async ({
  page,
}) => {
  const dismissed: unknown[] = [];
  await install(page, { dismissed });
  await page.goto("/overview");
  await page
    .getByTestId("todo-row")
    .first()
    .getByRole("button", { name: "Bỏ qua việc này" })
    .click();
  await expect.poll(() => dismissed.length).toBe(1);
  expect(dismissed[0]).toEqual({ key: TODO[0]?.key, action: "skip" });
});
test("«Cần xử lý»: 8 việc ⇒ hiện 6 + «Xem thêm 2 việc»; mở ra đủ 8, «Thu gọn» về 6; đếm quá hạn", async ({
  page,
}) => {
  await install(page);
  await page.goto("/overview");
  await expect(page.getByText("8 việc · 2 quá hạn")).toBeVisible();
  await expect(page.getByTestId("todo-row")).toHaveCount(6);
  await expect(page.getByTestId("todo-row").first()).toContainText("Thu tiền Khách An");
  const more = page.getByRole("button", { name: "Xem thêm 2 việc" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(page.getByTestId("todo-row")).toHaveCount(8);
  await page.getByRole("button", { name: "Thu gọn", exact: true }).click();
  await expect(page.getByTestId("todo-row")).toHaveCount(6);
});

test("«Cần xử lý»: đúng 6 việc ⇒ không có «Xem thêm»", async ({ page }) => {
  await install(page, { work: TODO.slice(0, 6) });
  await page.goto("/overview");
  await expect(page.getByTestId("todo-row")).toHaveCount(6);
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

test("«Đối tác cần xem lại»: đối tác mức CHÚ Ý; mức khác không hiện", async ({ page }) => {
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
  await expect(page.getByText("Không có đối tác nào có cờ đỏ hoặc ở mức CHÚ Ý.")).toBeVisible();
  await expect(page.getByTestId("review-partners")).toHaveCount(0);
});

const P = (
  name: string,
  role: "customer" | "supplier",
  o: Record<string, unknown> = {},
): Record<string, unknown> => ({
  party: `name:${name.toLowerCase()}`,
  name,
  role,
  roles: [role],
  score: 90,
  band: "good",
  reason: "",
  event_count: 8,
  adjust: 0,
  contracts: 1,
  ...o,
});

test("U3 · «Đối tác cần xem lại»: cờ đỏ hiện kể cả điểm cao, lên đầu; MỚI · tạm tính không hiện; link mở đúng đối tác", async ({
  page,
}) => {
  await install(page, {
    partners: [
      P("Beta Watch", "customer", { score: 50, band: "watch" }),
      P("Gamma Gian Lận", "supplier", {
        red_flag: true,
        red_flags: [{ type: "fraud", n: 1 }],
      }),
      P("Delta Mới", "customer", {
        score: null,
        band: null,
        provisional: true,
        provisional_score: 20,
        event_count: 1,
      }),
      P("Eps Tốt", "customer"),
    ],
  });
  await page.goto("/overview");
  const list = page.getByTestId("review-partners");
  const items = list.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Gamma Gian Lận");
  await expect(items.first().getByTestId("red-flag")).toContainText("Cờ đỏ · Gian lận");
  await expect(items.nth(1)).toContainText("Beta Watch");
  await expect(list).not.toContainText("Delta Mới");
  await expect(list).not.toContainText("Eps Tốt");
  await items.first().getByRole("link", { name: "Gamma Gian Lận" }).click();
  await expect(page).toHaveURL(/\/partners\?party=name%3Agamma/);
});
test("người xem (viewer): thấy cùng dữ liệu API trả, không có nút ghi sổ/HĐ", async ({ page }) => {
  await install(page, { role: "viewer" });
  await page.goto("/overview");
  await expect(page.getByTestId("todo-row")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Đã thu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Đã trả" })).toHaveCount(0);
});

test.describe("điện thoại (390×844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // CR-097 G2 thêm «Giao dịch» vào menu ⇒ thanh dưới 5 mục (5 cột vừa 390 px, không cần drawer «Thêm»).
  test("Tổng quan không cuộn ngang; thanh dưới đúng 5 mục, «Tổng quan» sáng", async ({ page }) => {
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
      "Giao dịch",
      "Đối tác",
      "Sản phẩm & Giá",
    ]);
    await expect(bottom.getByRole("link", { name: "Tổng quan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
