// products-confirm · BA 5.5 (khách 2026-10-22) · Luật 4b: hộp "Gắn sản phẩm" chỉ mở khi bước duyệt sẽ XÁC NHẬN HĐ (máy chủ báo
// `finalizes_on_approve`); SP trùng tên được chọn sẵn, đổi một dòng sang "Tạo sản phẩm mới" ⇒ thân `approve` mang `products`. Cấp 1 sẽ
// chuyển cấp 2 ⇒ không hộp, `approve` không kèm SP. Backend giả `page.route`; chờ phần tử, không sleep.
import type { ContractApproval } from "@ai/contracts";
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { approvalAsHub } from "./dataset-approval";
import { contract, contractAsHub } from "./dataset-contract";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const P1 = "f1000000-0000-4000-8000-000000000001";
const P2 = "f1000000-0000-4000-8000-000000000002";
const product = (id: string, name: string) => ({
  id,
  name,
  unit: null,
  spec: null,
  group: "goods",
  main_supplier: null,
  created_from_contract_id: null,
  components: [
    {
      id: `${id.slice(0, -1)}9`,
      ord: 0,
      name,
      unit: null,
      mode: "stock",
      on_hand: "0",
      avg_cost: 0,
      stock_value: 0,
    },
  ],
  rules: [],
});
const ITEM1 = "e1000000-0000-4000-8000-000000000001";
const ITEM2 = "e1000000-0000-4000-8000-000000000002";

async function install(page: Page, state: ContractApproval): Promise<unknown[]> {
  const approves: unknown[] = [];
  const d = asHub("editor");
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
  await page.route("**/pack/contracts/products?**", (r) =>
    json(r, 200, {
      items: [product(P1, "Thùng carton 5 lớp"), product(P2, "Màng co PE")],
      next_cursor: null,
    }),
  );
  await page.route("**/pack/contracts/contracts/**", (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/approval") && req.method() === "POST") {
      approves.push(req.postDataJSON());
      return json(r, 200, approvalAsHub("done"));
    }
    if (path.endsWith("/approval")) return json(r, 200, state);
    return json(r, 200, contractAsHub());
  });
  return approves;
}

test("cấp 1 sẽ xác nhận ⇒ hộp gắn SP: SP trùng chọn sẵn, một dòng tạo mới ⇒ approve kèm products", async ({
  page,
}) => {
  const approves = await install(page, approvalAsHub("level1", { finalizes_on_approve: true }));
  await page.goto(`/contracts/${contract.id}`);
  await page.getByRole("button", { name: "Xác nhận và lưu" }).click();
  const dlg = page.getByTestId("product-link-dialog");
  await expect(dlg).toContainText("Gắn sản phẩm cho các dòng hợp đồng");
  const row1 = page.getByTestId("plink-row-0");
  const row2 = page.getByTestId("plink-row-1");
  await expect(row1.getByLabel("Dùng sản phẩm có sẵn")).toBeChecked();
  await expect(row1.getByRole("combobox")).toHaveValue(P1);
  await expect(row2.getByRole("combobox")).toHaveValue(P2);
  await row2.getByLabel("Tạo sản phẩm mới").check();
  await expect(row2.getByRole("textbox")).toHaveValue("Màng co PE 25 micron");
  await page.getByTestId("product-link-confirm").click();
  await expect(dlg).toHaveCount(0);
  expect(approves).toEqual([
    {
      action: "approve",
      products: [
        { item_id: ITEM1, product_id: P1 },
        {
          item_id: ITEM2,
          new_product: { name: "Màng co PE 25 micron", unit: "cuộn", group: "goods" },
        },
      ],
    },
  ]);
});

test("cấp 1 sẽ chuyển cấp 2 ⇒ không hộp, approve không kèm SP", async ({ page }) => {
  const approves = await install(page, approvalAsHub("level1", { finalizes_on_approve: false }));
  await page.goto(`/contracts/${contract.id}`);
  await page.getByRole("button", { name: "Xác nhận và lưu" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toHaveText(
    "Đã lưu và xác nhận hợp đồng.",
  );
  expect(approves).toEqual([{ action: "approve" }]);
  await expect(page.getByTestId("product-link-dialog")).toHaveCount(0);
});
