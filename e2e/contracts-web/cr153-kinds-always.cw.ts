// CR-153 · «Nhượng quyền» + «Thỏa thuận hợp tác» luôn có ở: (a) «Thêm giao dịch» (kèm trường riêng), (b) khối «Thông tin hợp đồng» chi tiết HĐ mọi trạng thái.
// Backend giả `page.route`; không sleep. Viết, chưa chạy (điều phối chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const FIVE = [/^Mua/, /^Bán/, /^Giới thiệu/, /^Nhượng quyền/, /^Thỏa thuận hợp tác/];

test("Thêm giao dịch: đủ 5 loại; chọn Nhượng quyền hiện khối trường riêng", async ({ page }) => {
  await installV2f(page);
  await page.goto("/contracts/c/new?type=deal");
  for (const n of FIVE) await expect(page.getByRole("radio", { name: n })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(5);
  await page.getByRole("radio", { name: /^Nhượng quyền/ }).click();
  await expect(page.getByRole("radio", { name: /^Nhượng quyền/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("tablist")).toBeVisible();
});

test("Chi tiết HĐ đang hiệu lực: khối Thông tin hợp đồng vẫn hiện đủ 5 loại (khoá, chỉ đọc)", async ({
  page,
}) => {
  await installV2f(page, { contract: () => activeContract() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  for (const n of FIVE) await expect(page.getByRole("radio", { name: n })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Mua/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /^Nhượng quyền/ })).toBeDisabled();
});
