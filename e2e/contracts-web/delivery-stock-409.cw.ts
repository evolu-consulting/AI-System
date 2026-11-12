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
/** CR-127 U5: mốc nay là `ms-row`; bấm `ms-confirm` ⇒ hộp `fulfill-dialog` (Ý kiến + tệp bằng chứng bắt buộc), ghi bằng POST /obligations/:id/fulfill. */
async function openFulfill(page: Page, title: string) {
  // tệp bằng chứng tải lên POST /attachments trước khi gửi (EvidenceInput) ⇒ giả phản hồi
  await page.route("**/attachments", (r) =>
    r.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "a1000000-0000-4000-8000-000000000001",
        filename: "bien-ban.pdf",
      }),
    }),
  );
  await page.getByTestId("ms-row").filter({ hasText: title }).getByTestId("ms-confirm").click();
  const dlg = page.getByTestId("fulfill-dialog");
  await dlg.getByLabel(/Ý kiến/).fill("Đã giao đủ theo biên bản.");
  await dlg.locator("input[type=file]").setInputFiles({
    name: "bien-ban.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 bien ban"),
  });
  await expect(dlg.getByText("bien-ban.pdf")).toBeVisible();
  return dlg;
}

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

// CR-127: không còn bước PATCH items / settle — chỉ POST /obligations/:id/fulfill; 409 ở đó phải hiện câu tồn kho thật.
test('giao vượt tồn (409 STOCK_INSUFFICIENT ở fulfill) ⇒ hiện câu tồn kho không đủ, không hiện "Dữ liệu vừa được cập nhật"', async ({
  page,
}) => {
  await installV2f(page);
  await page.route(`**${P}/milestones/${M3}/delivery`, (r) => r.fulfill(json(VIEW)));
  await page.route(`**${P}/obligations/${M3}/fulfill`, (r) =>
    r.fulfill(json({ error: { code: "STOCK_INSUFFICIENT", message: MSG } }, 409)),
  );
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const dlg = await openFulfill(page, "Giao đợt 2");
  await dlg.getByTestId("fulfill-ok").click();
  const body = page.locator("body");
  await expect(body).toContainText(MSG);
  await expect(body).not.toContainText("Dữ liệu vừa được cập nhật");
});
