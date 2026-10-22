// V2-M · HD-07 · Luật 4b: vai quản lý thấy "Xoá hợp đồng" ⇒ hộp xác nhận liệt kê tác động (xem trước) ⇒ "Xoá hẳn" ⇒ MỘT DELETE ⇒ về
// danh sách; editor không thấy nút. Backend giả `page.route`; chờ phần tử, không sleep. (Viết trong lát, chạy ở cuối đợt — Luật 0b.)
import { expect, type Route, test } from "@playwright/test";
import { ACTIVE_ID } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const impact = {
  contract: { id: ACTIVE_ID, number: "HD-1", title: "Hợp đồng thử" },
  milestones: 2,
  delivered_lines: 1,
  stock: [{ product: "Hàng A", component: "Hàng A", direction: "out", qty: "4" }],
  service_customers: 1,
  products: ["Dịch vụ B"],
  orphan_products: [{ id: "00000000-0000-4000-8000-0000000000b1", name: "Dịch vụ B" }],
  partner_events: 3,
  appendices: 0,
  has_cks: false,
  stock_blocked: null,
};

// products-confirm: SP mồ côi hiện ô chọn (mặc định không chọn); tick ⇒ thân DELETE mang `remove_products`.
test("owner: xem trước tác động rồi xoá hẳn ⇒ một DELETE", async ({ page }) => {
  await installV2f(page, { role: "owner" });
  const deletes: string[] = [];
  const url = `**/pack/contracts/contracts/${ACTIVE_ID}`;
  await page.route(`${url}/delete-preview`, (r) => json(r, 200, impact));
  await page.route(url, (r) => {
    if (r.request().method() !== "DELETE") return r.fallback();
    deletes.push(r.request().postData() ?? "");
    return json(r, 200, { deleted: true, audit_id: "1", impact: {} });
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByTestId("delete-contract").click();
  const list = page.getByTestId("delete-impact");
  await expect(list).toContainText("Hàng A");
  const orphans = page.getByTestId("delete-orphans");
  await expect(orphans).toContainText("Xoá các sản phẩm không còn hợp đồng nào dùng?");
  await orphans.getByRole("checkbox", { name: "Dịch vụ B" }).check();
  await page.getByTestId("delete-confirm").click();
  await expect(page).toHaveURL(/\/contracts$/);
  expect(deletes.map((b) => JSON.parse(b))).toEqual([
    { remove_products: ["00000000-0000-4000-8000-0000000000b1"] },
  ]);
});

test("editor: không có nút xoá", async ({ page }) => {
  await installV2f(page, { role: "editor" });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByTestId("delete-contract")).toHaveCount(0);
});
