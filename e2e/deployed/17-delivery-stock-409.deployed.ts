// Luồng 17 · ca lỗi người dùng "409 nghiệp vụ hiện «Dữ liệu vừa được cập nhật»" (giao vượt tồn kho) trên bản build THẬT của contracts-web.
// Demo không có HĐ bán + mốc giao vượt tồn ⇒ API pack giả NGAY trong trình duyệt (backend giả v2f + 409 STOCK_INSUFFICIENT): không ghi gì
// lên máy chủ, không cần mật khẩu. Kiểm cách bản build đang chạy hiện lỗi; luật server (409 khi thiếu tồn) có int ở hub-api.
import { ACTIVE_ID } from "../contracts-web/dataset-v2f";
import { installV2f } from "../contracts-web/v2f-support";
import { CW, expect, test } from "./_support";

const P = "/pack/contracts";
const M3 = "d1000000-0000-4000-8000-000000000103";
const MSG = "Kho Chữ ký số không đủ: cần 30, còn 10";
const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});
const VIEW = {
  milestone_id: M3,
  status: "open",
  pct: 30,
  allow_negative: false,
  rows: [
    {
      item_id: "i1000000-0000-4000-8000-000000000001",
      name: "Chữ ký số",
      unit: "cái",
      product_id: null,
      on_contract: "100",
      delivered: "0",
      this_time: "30",
      remaining: "100",
    },
  ],
};

test("[lỗi: 409 nghiệp vụ hiện «Dữ liệu vừa được cập nhật»] giao vượt tồn ⇒ hiện câu tồn kho thật", async ({
  page,
}) => {
  await installV2f(page);
  await page.route(`**${P}/milestones/${M3}/delivery`, (r) => r.fulfill(json(VIEW)));
  await page.route(`**${P}/obligations/*/settle`, (r) =>
    r.fulfill(json({ error: { code: "STOCK_INSUFFICIENT", message: MSG } }, 409)),
  );
  await page.goto(`${CW}/contracts/${ACTIVE_ID}`);
  await page
    .locator('li[data-node="milestone"]', { hasText: "Giao đợt 2" })
    .getByRole("button", { name: "Xác nhận xong" })
    .click();
  const box = page.getByTestId("confirm-box");
  await box.getByLabel("Giao đợt này · Chữ ký số").fill("30");
  await box.getByRole("button", { name: "Xác nhận" }).click();
  const body = page.locator("body");
  await expect(body).toContainText(MSG);
  await expect(body).not.toContainText("Dữ liệu vừa được cập nhật");
});
