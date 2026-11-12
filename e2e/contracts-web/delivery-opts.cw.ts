// delivery-opts · Luật 4b: (1) mốc Giao hàng ghi % (thêm mốc gửi `pct`, ô SL chung bị khoá khi có %); (2) xác nhận đợt hiện SL tính sẵn,
// sửa được ⇒ PATCH items rồi settle, giao vượt tồn ⇒ toast cảnh báo; (3) Cài đặt › Công ty có công tắc "Cho phép giao vượt tồn kho"
// (mặc định tắt) ⇒ PUT /company `allow_negative_stock`. Backend giả `page.route`; không sleep. Viết sẵn, CHƯA chạy (Luật 0b).
import { expect, type Page, test } from "@playwright/test";
import { ACTIVE_ID } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const P = "/pack/contracts";
const M3 = "d1000000-0000-4000-8000-000000000103";
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
  allow_negative: true,
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

test.describe("đợt giao theo %", () => {
  // CR-127 Q11 (người dùng chốt): bỏ nút «+ Thêm mốc» trên HĐ thường là đúng ý — ca «Giao theo %» khi thêm mốc đã xoá.

  test("xác nhận đợt (Nhận việc/hộp xác nhận mới): SL tính sẵn 30, sửa thành 25 ⇒ POST fulfill có qty_items", async ({
    page,
  }) => {
    const sent = await installV2f(page);
    await page.route(`**${P}/milestones/${M3}/delivery`, (r) => r.fulfill(json(VIEW)));
    await page.route(`**${P}/obligations/${M3}/fulfill`, (r) => {
      sent.push({
        method: "POST",
        path: new URL(r.request().url()).pathname,
        body: r.request().postDataJSON(),
      });
      return r.fulfill(json({ id: M3, status: "done" }));
    });
    await page.goto(`/contracts/c/${ACTIVE_ID}`);
    const dlg = await openFulfill(page, "Giao đợt 2");
    const qty = dlg.getByLabel("Giao đợt này · Chữ ký số");
    await expect(qty).toHaveValue("30");
    await qty.fill("25");
    const res = page.waitForResponse((r) => r.url().includes(`/obligations/${M3}/fulfill`));
    await dlg.getByTestId("fulfill-ok").click();
    await res;
    await expect(dlg).toHaveCount(0);
    expect(sent.at(-1)).toMatchObject({ method: "POST", path: `${P}/obligations/${M3}/fulfill` });
    expect(((sent.at(-1)?.body ?? {}) as { qty_items?: unknown }).qty_items).toEqual([
      { contract_item_id: VIEW.rows[0]?.item_id, qty: 25 },
    ]);
  });
});

test("Cài đặt › Công ty: công tắc «Cho phép giao vượt tồn kho» mặc định tắt; bật + Lưu ⇒ PUT allow_negative_stock", async ({
  page,
}) => {
  const sent = await installV2f(page, { role: "owner" });
  const CO = {
    name: "NITI GROUP",
    app_name: null,
    logo: null,
    accent: "indigo",
    theme: "light",
    own_names: [],
    own_tax_ids: [],
  };
  const out = (allow: boolean) => ({
    company: CO,
    approval_enabled: true,
    allow_negative_stock: allow,
    defaults: { ...CO, approval_enabled: true, allow_negative_stock: false },
    version: 0,
    updated_at: null,
  });
  await page.route(`**${P}/company`, (r) => {
    if (r.request().method() === "PUT") {
      sent.push({ method: "PUT", path: `${P}/company`, body: r.request().postDataJSON() });
      return r.fulfill(json(out(true)));
    }
    return r.fulfill(json(out(false)));
  });
  const BIZ = {
    w: { rot: 40, margin: 35, trend: 25 },
    buyDays: 45,
    dumpDays: 150,
    quotaBuy: 120,
    quotaDump: 70,
    hi: 70,
    lo: 45,
    vol: 6,
    soon: 60,
  };
  await page.route(`**${P}/business/config`, (r) =>
    r.fulfill(json({ config: BIZ, defaults: BIZ, version: 0, updated_at: null })),
  );
  await page.goto("/contracts");
  await page
    .getByRole("button", { name: /tài khoản|account/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Cài đặt" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  const sw = dlg.getByRole("switch", { name: "Cho phép giao vượt tồn kho" });
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await dlg.getByRole("button", { name: "Lưu cài đặt" }).click();
  await expect
    .poll(() => sent.find((s) => s.path === `${P}/company`)?.body)
    .toMatchObject({ allow_negative_stock: true });
});
