// V2-J1 · SP-01/02/07: trang Sản phẩm & Giá — tab "Sản phẩm" (mặc định): tab nhóm + số lượng, cột Tên/Loại/Đang nắm giữ/Đã bán/Điểm kinh
// doanh (+ đề xuất); bấm hàng mở chi tiết: tóm tắt + 3 thanh, tab Lịch sử mua bán (lô, bán) và Hợp đồng · n. Backend giả `page.route`; không sleep.
// Viết sẵn, CHƯA chạy (Luật 0b: e2e chạy một lần ở cuối đợt).
import { expect, type Page, test } from "@playwright/test";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const GOODS = "e2000000-0000-4000-8000-000000000001";
const SVC = "e2000000-0000-4000-8000-000000000002";
const REF = "e2000000-0000-4000-8000-000000000003";
const bar = (key: string, label: string, weight: number, value: number | null, detail: string) => ({
  key,
  label,
  weight,
  value,
  detail,
});
const row = (id: string, name: string, group: string, o: Record<string, unknown>) => ({
  id,
  name,
  unit: "cái",
  group,
  kind: group === "referral" ? "referral" : group === "service" ? "quota" : "stock",
  held: { qty: 0, unit: "cái", expires_on: null, value: 0 },
  sold_12m: 0,
  sold_3m: 0,
  business: { score: null, suggestion: null, reason: "Chưa bán lần nào.", factors: [] },
  ...o,
});
const ITEMS = [
  row(GOODS, "Băng keo trong", "goods", {
    held: { qty: 170, unit: "cái", expires_on: null, value: 1_870_000 },
    sold_12m: 30,
    sold_3m: 30,
    business: {
      score: 62,
      suggestion: "dump",
      reason: "Tồn đủ bán 516 ngày (> 150).",
      factors: [
        bar("rot", "Tốc độ bán", 40, 0, "~10 cái/tháng · tồn đủ bán 516 ngày"),
        bar("margin", "Biên lãi", 35, 100, "27% trên giá bán"),
        bar("trend", "Xu hướng", 25, 100, "3 tháng gần: 30 · 3 tháng trước: 0"),
      ],
    },
  }),
  row(SVC, "Chứng thư số 1 năm", "service", {
    unit: "suất",
    held: { qty: 40, unit: "suất", expires_on: "2026-12-31", value: 8_000_000 },
    sold_12m: 90,
    sold_3m: 45,
    business: {
      score: 81,
      suggestion: "buy",
      reason: "Dự kiến bán 150% số suất trước hạn.",
      factors: [],
    },
  }),
  row(REF, "Giới thiệu bảo hiểm", "referral", {
    sold_12m: 2,
    sold_3m: 1,
    business: { score: 40, suggestion: "stop", reason: "Điểm < 45.", factors: [] },
  }),
];
const DETAIL = {
  product: ITEMS[0],
  revenue_12m: 450_000,
  margin_pct: 26.7,
  contracts_count: 3,
  lots: [
    {
      id: "l2",
      received_on: "2026-10-01",
      qty: 100,
      remaining: 100,
      unit_cost: 12_000,
      price_change: 2_000,
      expires_on: null,
      supplier: "Bao Bì Phương Nam",
      contract_id: null,
      component: "Băng keo trong",
    },
    {
      id: "l1",
      received_on: "2026-09-01",
      qty: 100,
      remaining: 70,
      unit_cost: 10_000,
      price_change: null,
      expires_on: null,
      supplier: "Bao Bì Phương Nam",
      contract_id: null,
      component: "Băng keo trong",
    },
  ],
  sales: [
    {
      on: "2026-10-10",
      contract_id: "c1000000-0000-4000-8000-0000000000a1",
      contract_title: "HĐ bán băng keo",
      customer: "Khách A",
      qty: 30,
      unit_price: 15_000,
      cost: 330_000,
      profit: 120_000,
    },
  ],
};
const CONTRACTS = [
  {
    id: "c1000000-0000-4000-8000-0000000000a1",
    title: "HĐ bán băng keo",
    number: "01/2026/HĐB",
    deal: "sell",
    status: "active",
    partner: "Khách A",
    value: 450_000,
    start_date: "2026-10-01",
    commission_total: null,
    commission_received: null,
  },
];

async function install(page: Page) {
  await installV2f(page);
  const j = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/pack/contracts/business/products", (r) =>
    r.fulfill(j({ items: ITEMS, counts: { all: 3, service: 1, goods: 1, referral: 1 } })),
  );
  await page.route(`**/pack/contracts/business/products/${GOODS}`, (r) => r.fulfill(j(DETAIL)));
  await page.route(`**/pack/contracts/business/products/${GOODS}/contracts`, (r) =>
    r.fulfill(j({ items: CONTRACTS })),
  );
}

test("danh sách: một trang (V2-O gộp tab), mặc định nhóm Tất cả, 4 tab nhóm có số lượng, 5 cột", async ({
  page,
}) => {
  await install(page);
  await page.goto("/products");
  await expect(page.getByRole("tablist", { name: "Nhóm sản phẩm" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tất cả · 3" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Sản phẩm", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Tất cả · 3" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Dịch vụ có hạn · 1" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Hàng hoá · 1" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Giới thiệu · 1" })).toBeVisible();
  await expect(page.locator("main thead th")).toHaveText([
    "Tên",
    "Loại",
    "Đang nắm giữ",
    "Đã bán",
    "Điểm kinh doanh",
  ]);
});

test("hàng: nắm giữ (gói kèm hạn), đã bán, điểm + đề xuất; tab Hàng hoá lọc", async ({ page }) => {
  await install(page);
  await page.goto("/products");
  const svc = page.locator("main tbody tr", { hasText: "Chứng thư số 1 năm" });
  await expect(svc.locator("td").nth(2)).toContainText("40 suất");
  await expect(svc.locator("td").nth(2)).toContainText("hết hạn 31/12/2026");
  await expect(svc.locator("td").nth(4)).toContainText("81");
  await expect(svc.locator("td").nth(4)).toContainText("Mua thêm");
  await expect(
    page.locator("main tbody tr", { hasText: "Giới thiệu bảo hiểm" }).locator("td").nth(4),
  ).toContainText("Cân nhắc dừng");
  await page.getByRole("tab", { name: "Hàng hoá · 1" }).click();
  await expect(page.locator("main tbody tr")).toHaveCount(1);
  await expect(page).toHaveURL(/g=goods/);
});

test("chi tiết: tóm tắt + 3 thanh; Lịch sử mua bán (lô chênh giá, bán có lãi); Hợp đồng · n", async ({
  page,
}) => {
  await install(page);
  await page.goto("/products");
  await page.locator("main tbody tr", { hasText: "Băng keo trong" }).locator("td").first().click();
  await expect(page).toHaveURL(new RegExp(`sp=${GOODS}`));
  await expect(page.getByRole("heading", { name: "Băng keo trong" })).toBeVisible();
  await expect(page.getByText("Tồn đủ bán 516 ngày (> 150).")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(3);
  await expect(page.getByRole("tab", { name: "Hợp đồng · 3" })).toBeVisible();
  await expect(page.locator("main tbody tr").first()).toContainText("+2.000 đ");
  await page.getByRole("radio", { name: /^Bán/ }).click();
  await expect(page.locator("main tbody tr").first()).toContainText("120.000 đ");
  await page.getByRole("tab", { name: "Hợp đồng · 3" }).click();
  await expect(page.locator("main tbody tr").first()).toContainText("HĐ bán băng keo");
});
