// V2-J2 · SP-04/05/06 · Luật 4b: tab "Nhà cung cấp & giá" — bảng so sánh với giá vốn BQ (Mua mới / Gia hạn), "Tìm giá trên thị trường" chỉ
// chạy khi bấm "Tìm" (hộp thoại nói rõ chỉ gửi tên SP), tick dòng rồi lưu = MỘT POST /supplier-prices, gợi ý hợp tác. Backend giả `page.route`
// (không AI thật). Viết sẵn, CHƯA chạy (e2e chạy một lần cuối đợt — Luật 0b). Chờ phần tử/yêu cầu, không sleep.

import type { SupplierOverviewOut } from "@ai/contracts";
import { expect, type Page, type Route, test } from "@playwright/test";
import { installV2f, type Sent } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const PID = "00000000-0000-4000-8000-0000000000a1";
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const OVERVIEW: SupplierOverviewOut = {
  product: { id: PID, name: "USB Token ký số", unit: "cái", group: "goods" },
  own_avg_cost: 100_000,
  rows: [
    {
      id: "p1",
      supplier_name: "FPT IS",
      party_key: "name:fpt is",
      kind: "renew",
      price: 90_000,
      unit: "cái",
      source: "market",
      url: "https://fpt.vn/token",
      on: "2026-10-10",
      vs_own_pct: -10,
      reputation: null,
    },
    {
      id: null,
      supplier_name: "VNPT",
      party_key: "tax:0100684378",
      kind: "new",
      price: 100_000,
      unit: "cái",
      source: "purchase",
      url: null,
      on: "2026-10-01",
      vs_own_pct: 0,
      reputation: { score: 90, level: "good" },
    },
  ],
  suppliers: [
    {
      supplier_name: "VNPT",
      party_key: "tax:0100684378",
      bought_qty: "80",
      bought_times: 4,
      bought_amount: 8_000_000,
      share_pct: 100,
      last_on: "2026-10-01",
      last_price: 100_000,
      best_price: 100_000,
      reputation: { score: 90, level: "good" },
      advice: "keep",
    },
    {
      supplier_name: "FPT IS",
      party_key: "name:fpt is",
      bought_qty: "0",
      bought_times: 0,
      bought_amount: 0,
      share_pct: 0,
      last_on: null,
      last_price: null,
      best_price: 90_000,
      reputation: null,
      advice: "trial",
    },
  ],
};
const FOUND = {
  query: "USB Token ký số",
  items: [
    {
      supplier_name: "Viettel",
      kind: "new",
      price: 130_000,
      unit: "cái",
      url: "https://viettel.vn/t",
      seen_on: "2026-10-05",
      note: null,
    },
  ],
};

async function open(page: Page, overview: SupplierOverviewOut = OVERVIEW): Promise<Sent[]> {
  const sent = await installV2f(page);
  await page.route(
    (u) => u.pathname.startsWith(`/pack/contracts/products/${PID}`),
    (r) => {
      const q = r.request();
      const path = new URL(q.url()).pathname;
      if (q.method() !== "GET") {
        let body: unknown = null;
        try {
          body = q.postDataJSON();
        } catch {
          body = null;
        }
        sent.push({ method: q.method(), path, body });
      }
      if (path.endsWith("/suppliers/search")) return json(r, 200, FOUND);
      if (path.endsWith("/supplier-prices")) return json(r, 201, { ids: ["n1"] });
      return json(r, 200, overview);
    },
  );
  await page.goto(`/products?sp=${PID}&ht=suppliers`);
  return sent;
}

test("bảng so sánh: giá vốn BQ, Mua mới mặc định, chuyển Gia hạn; đánh giá NCC có gợi ý", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText("Giá vốn bình quân của mình")).toBeVisible();
  await expect(page.getByRole("cell", { name: "VNPT" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "FPT IS" })).toHaveCount(0); // FPT chỉ có giá Gia hạn
  await page.getByRole("button", { name: "Gia hạn" }).click();
  await expect(page.getByRole("cell", { name: "FPT IS" }).first()).toBeVisible();
  await expect(page.getByText("Hợp tác tiếp")).toBeVisible();
  await expect(page.getByText("Có thể mua thử")).toBeVisible();
});

test("tìm giá: chỉ chạy khi bấm Tìm (nói rõ chỉ gửi tên SP); lưu dòng đã chọn = MỘT POST", async ({
  page,
}) => {
  const sent = await open(page);
  await page.getByRole("button", { name: "Tìm giá trên thị trường" }).click();
  await expect(page.getByText(/Chỉ tên sản phẩm được gửi đi/)).toBeVisible();
  expect(sent.filter((s) => s.path.endsWith("/suppliers/search"))).toHaveLength(0);
  const search = page.waitForRequest((q) => q.url().endsWith("/suppliers/search"));
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  expect((await search).postDataJSON()).toEqual({});
  await expect(page.getByText("Viettel")).toBeVisible();
  const save = page.waitForRequest(
    (q) => q.url().endsWith("/supplier-prices") && q.method() === "POST",
  );
  await page.getByRole("button", { name: /Lưu 1 dòng vào bảng so sánh/ }).click();
  const body = (await save).postDataJSON() as {
    items: { supplier_name: string; source: string }[];
  };
  expect(body.items).toMatchObject([{ supplier_name: "Viettel", source: "market" }]);
});

test("SP Giới thiệu: không hiện tab", async ({ page }) => {
  await open(page, { ...OVERVIEW, product: { ...OVERVIEW.product, group: "referral" } });
  await expect(page.getByText("So sánh giá nhà cung cấp")).toHaveCount(0);
});
