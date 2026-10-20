// V2-H · SP-03 · Luật 4b: tab "Khách đang dùng" của chi tiết SP (V2-J1: /products?sp=…&ht=users, chỗ gắn `lib/slots.ts`) — nút lọc Tất cả / Hết hạn / Sắp hết hạn / Còn hạn kèm
// số, nhãn hạn, "Nhắc gia hạn" chỉ cho khách hết / sắp hết hạn ⇒ MỘT POST remind ⇒ "Đã nhắc". Backend giả `page.route`; chờ phần tử,
// không sleep. (Viết trong lát, chạy ở cuối đợt — Luật 0b.)
import { expect, type Route, test } from "@playwright/test";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const PID = "e1000000-0000-4000-8000-0000000000c1";
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const row = (
  id: string,
  name: string,
  exp: string,
  days: number,
  status: string,
  reminded = false,
) => ({
  id: `e2000000-0000-4000-8000-00000000000${id}`,
  customer_name: name,
  party_key: `name:${name}`,
  contract_id: `e3000000-0000-4000-8000-00000000000${id}`,
  contract_number: `HD-${id}`,
  contract_title: null,
  started_on: null,
  expires_on: exp,
  notice_days: 60,
  days_left: days,
  status,
  renewals: 0,
  reminded,
});
const out = (reminded: boolean) => ({
  product: { id: PID, name: "Chữ ký số 1 năm", group: "service" },
  today: "2026-10-18",
  notice_default: 60,
  counts: { all: 3, expired: 1, soon: 1, active: 1 },
  truncated: false,
  items: [
    row("1", "Khách Hết", "2026-10-13", -5, "expired"),
    row("2", "Khách Sắp", "2026-11-07", 20, "soon", reminded),
    row("3", "Khách Còn", "2027-01-26", 100, "active"),
  ],
});

test("lọc theo hạn + Nhắc gia hạn ⇒ việc vào Cần xử lý, hàng chuyển 'Đã nhắc'", async ({
  page,
}) => {
  const sent = await installV2f(page);
  let reminded = false;
  // Chi tiết SP của V2-J1 (tab gắn qua `lib/slots.ts`): tóm tắt tối thiểu, chưa có điểm.
  await page.route(`**/pack/contracts/business/products/${PID}`, (r) =>
    json(r, 200, {
      product: {
        id: PID,
        name: "Chữ ký số 1 năm",
        unit: null,
        group: "service",
        kind: "quota",
        held: { qty: 0, unit: null, expires_on: null, value: 0 },
        sold_12m: 3,
        sold_3m: 1,
        business: { score: null, suggestion: null, reason: "", factors: [] },
      },
      revenue_12m: 0,
      margin_pct: null,
      lots: [],
      sales: [],
      contracts_count: 3,
    }),
  );
  await page.route(`**/pack/contracts/products/${PID}/customers`, (r) =>
    json(r, 200, out(reminded)),
  );
  await page.route(`**/pack/contracts/products/${PID}/customers/*/remind`, (r) => {
    sent.push({ method: "POST", path: new URL(r.request().url()).pathname, body: null });
    reminded = true;
    return json(r, 201, {
      id: "e4000000-0000-4000-8000-000000000001",
      title: "Liên hệ Khách Sắp mời gia hạn Chữ ký số 1 năm",
    });
  });
  await page.goto(`/products?sp=${PID}&ht=users`);
  await expect(page.getByRole("tab", { name: "Khách đang dùng" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("còn 20 ngày")).toBeVisible();
  await expect(page.getByText("đã hết 5 ngày")).toBeVisible();
  // Còn hạn ⇒ không có nút nhắc; hết / sắp hết ⇒ có.
  await expect(page.getByRole("button", { name: "Nhắc gia hạn" })).toHaveCount(2);
  await page.getByRole("button", { name: "Sắp hết hạn · 1" }).click();
  await expect(page.getByText("Khách Hết")).toHaveCount(0);
  await page.getByRole("button", { name: "Nhắc gia hạn" }).click();
  await expect(
    page.getByText("Đã thêm vào Cần xử lý: liên hệ Khách Sắp mời gia hạn"),
  ).toBeVisible();
  await expect(page.getByText("Đã nhắc")).toBeVisible();
  expect(sent.filter((s) => s.path.endsWith("/remind"))).toHaveLength(1);
});
