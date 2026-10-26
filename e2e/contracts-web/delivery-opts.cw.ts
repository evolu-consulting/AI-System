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
const node = (page: Page, title: string) =>
  page.locator('li[data-node="milestone"]', { hasText: title });

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
  test("«+ Thêm mốc» Giao hàng có ô «Giao theo %»: nhập 30 ⇒ POST có pct, khoá ô SL chung", async ({
    page,
  }) => {
    const sent = await installV2f(page);
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await page.getByRole("button", { name: "+ Thêm mốc" }).click();
    const dlg = page.getByRole("dialog", { name: "Thêm mốc" });
    await dlg.getByLabel(/^Tên mốc/).fill("Giao đợt 1");
    await dlg.getByLabel(/^Hạn/).fill("2026-11-15");
    await dlg.getByLabel("Giao theo %").fill("30");
    await expect(dlg.getByLabel("Số lượng giao")).toBeDisabled();
    await dlg.getByRole("button", { name: "Thêm mốc" }).click();
    await expect(dlg).toHaveCount(0);
    expect(sent.at(-1)).toMatchObject({
      method: "POST",
      path: `${P}/contracts/${ACTIVE_ID}/milestones`,
      body: { kind: "delivery", qty: null, pct: 30 },
    });
  });

  test("xác nhận đợt: SL tính sẵn 30, sửa thành 25 ⇒ PATCH items rồi settle; phản hồi vượt tồn ⇒ toast cảnh báo", async ({
    page,
  }) => {
    const sent = await installV2f(page);
    await page.route(`**${P}/milestones/${M3}/delivery`, (r) => r.fulfill(json(VIEW)));
    await page.route(`**${P}/obligations/*/settle`, (r) => {
      sent.push({
        method: "POST",
        path: new URL(r.request().url()).pathname,
        body: r.request().postDataJSON(),
      });
      return r.fulfill(
        json({
          id: M3,
          status: "done",
          delivery: {
            items: [],
            stock: [],
            notes: [],
            overdrawn: [{ component_id: "c", name: "Chữ ký số", need: "25", have: "10" }],
          },
        }),
      );
    });
    await page.goto(`/contracts/${ACTIVE_ID}`);
    await node(page, "Giao đợt 2").getByRole("button", { name: "Xác nhận xong" }).click();
    const box = page.getByTestId("confirm-box");
    const qty = box.getByLabel("Giao đợt này · Chữ ký số");
    await expect(qty).toHaveValue("30");
    await qty.fill("25");
    await box.getByRole("button", { name: "Xác nhận" }).click();
    await expect(box).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("Đã giao vượt tồn");
    expect(sent.slice(-2).map((s) => [s.method, s.path])).toEqual([
      ["PATCH", `${P}/milestones/${M3}`],
      ["POST", `${P}/obligations/${M3}/settle`],
    ]);
    expect(sent.at(-2)?.body).toEqual({
      items: [{ item_id: VIEW.rows[0]?.item_id, qty: 25 }],
    });
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
  await page.goto("/overview");
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
