// Ca lỗi người dùng: giao hàng vượt tồn kho ⇒ server 409 STOCK_INSUFFICIENT kèm câu tiếng Việt. Màn xác nhận đợt giao phải hiện câu thật
// (+ gợi ý), KHÔNG hiện câu chung "Dữ liệu vừa được cập nhật" (chỉ dành cho xung đột phiên bản). Backend giả `page.route`; không sleep.
import { expect, type Page, test } from "@playwright/test";
import { ACTIVE_ID } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const P = "/pack/contracts";
const M3 = "d1000000-0000-4000-8000-000000000103";
const MSG = "Kho Chữ ký số không đủ: cần 30, còn 10";
const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});
const node = (page: Page, title: string) =>
  page.locator('li[data-node="milestone"]', { hasText: title });

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

for (const stage of ["settle", "patch"] as const) {
  test(`giao vượt tồn (409 STOCK_INSUFFICIENT ở ${stage}) ⇒ hiện câu tồn kho không đủ, không hiện "Dữ liệu vừa được cập nhật"`, async ({
    page,
  }) => {
    await installV2f(page);
    await page.route(`**${P}/milestones/${M3}/delivery`, (r) => r.fulfill(json(VIEW)));
    const stock409 = (r: { fulfill: (o: object) => Promise<void> }) =>
      r.fulfill(json({ error: { code: "STOCK_INSUFFICIENT", message: MSG } }, 409));
    if (stage === "settle") {
      await page.route(`**${P}/obligations/*/settle`, stock409);
    } else {
      await page.route(`**${P}/milestones/${M3}`, (r) =>
        r.request().method() === "PATCH" ? stock409(r) : r.fallback(),
      );
    }
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await node(page, "Giao đợt 2").getByRole("button", { name: "Xác nhận xong" }).click();
    const box = page.getByTestId("confirm-box");
    const qty = box.getByLabel("Giao đợt này · Chữ ký số");
    await qty.fill(stage === "patch" ? "25" : "30"); // khác SL tính sẵn ⇒ mới có PATCH items
    await box.getByRole("button", { name: "Xác nhận" }).click();
    const body = page.locator("body");
    await expect(body).toContainText(MSG);
    await expect(body).not.toContainText("Dữ liệu vừa được cập nhật");
  });
}
