// DOC-ui-list · R5–R10 · Câu 3, 4 · Luật 4b: Giao dịch là chứng từ — form dùng chung (`/contracts/new?type=deal`) gọi `POST /contracts/deals`
// (nguồn, ô «Đã giao / đã thanh toán ngay», `settle_error`), gắn HĐ nguyên tắc qua `?frame=` + `/attach`; `/transactions*` chuyển hướng.
// Thay bản G2 cũ (đã gỡ cùng trang Giao dịch riêng). Backend giả `page.route`; không sleep.
import { expect, type Page, type Route, test } from "@playwright/test";
import { ACTIVE_ID, activeContract, NEW_ID, P_TOKEN } from "./dataset-v2f";
import { installV2f, type Sent } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const deals = (sent: Sent[]) => sent.find((s) => s.path === "/pack/contracts/contracts/deals");

async function install(page: Page, settleError: string | null = null) {
  const sent = await installV2f(page);
  await page.route("**/pack/contracts/contracts/deals", (r) => {
    sent.push({
      method: "POST",
      path: new URL(r.request().url()).pathname,
      body: r.request().postDataJSON(),
    });
    return json(r, 201, {
      id: NEW_ID,
      doc_type: "deal",
      status: "active",
      version: 1,
      settled: [],
      settle_error: settleError,
    });
  });
  // Ngưỡng cảnh báo pháp lý + nhận diện công ty (Shell cũng đọc /company).
  const co = {
    name: "Acme",
    app_name: null,
    logo: null,
    accent: "indigo",
    theme: "light",
    own_names: [],
    own_tax_ids: [],
  };
  await page.route("**/pack/contracts/company", (r) =>
    json(r, 200, {
      company: co,
      approval_enabled: false,
      allow_negative_stock: false,
      legal_warn_threshold: 5_000_000,
      defaults: { ...co, name: null, theme: "auto", approval_enabled: false },
      version: 1,
      updated_at: null,
    }),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/attach`, (r) => {
    sent.push({
      method: "POST",
      path: new URL(r.request().url()).pathname,
      body: r.request().postDataJSON(),
    });
    return json(r, 200, { frame_root_id: ACTIVE_ID, attached: [NEW_ID] });
  });
  // Sau khi lưu, form đọc chi tiết giao dịch mới để gắn SP mới (không có dòng SP mới ⇒ không gọi thêm).
  await page.route(`**/pack/contracts/contracts/${NEW_ID}`, (r) =>
    json(r, 200, { ...activeContract(), id: NEW_ID, items: [] }),
  );
  return sent;
}

async function fillDeal(page: Page, source: string | null = "invoice") {
  await page.getByLabel(/^Tên giao dịch/).fill("Bán token tháng 10");
  await page.getByLabel(/^Nhà cung cấp/).fill("Công ty TNHH Bao Bì Phương Nam");
  await page.getByLabel(/^Ngày giao dịch/).fill("2026-10-18");
  await page.getByLabel("Tên hàng").first().fill("USB Token");
  await page.getByLabel("Số lượng", { exact: true }).first().fill("3");
  await page.getByLabel("Đơn giá", { exact: true }).first().fill("500000");
  await expect(page.getByLabel("Gắn dòng 1 với sản phẩm")).toHaveValue(P_TOKEN.id);
  if (source) await page.getByLabel(/^Nguồn giao dịch/).selectOption(source);
}

test("form Giao dịch: nhãn riêng, không có ô chỉ của HĐ (kết thúc, nhắc hạn, người ký)", async ({
  page,
}) => {
  await install(page);
  await page.goto("/contracts/new?type=deal");
  await expect(page.getByLabel(/^Tên giao dịch/)).toBeVisible();
  await expect(page.getByLabel("Số chứng từ")).toBeVisible();
  await expect(page.getByLabel(/^Ngày giao dịch/)).toBeVisible();
  await expect(page.getByLabel(/^Nguồn giao dịch/)).toBeVisible();
  await expect(page.getByLabel(/^Đã giao \/ đã thanh toán ngay/)).not.toBeChecked();
  await expect(page.getByLabel("Hiệu lực đến")).toHaveCount(0);
  await expect(page.getByLabel("Tên hợp đồng")).toHaveCount(0);
});

test("lưu: POST /contracts/deals với deal + source + settled_now, xong mở giao dịch", async ({
  page,
}) => {
  const sent = await install(page);
  await page.goto("/contracts/new?type=deal");
  await fillDeal(page);
  await page.getByLabel(/^Đã giao \/ đã thanh toán ngay/).check();
  await page.getByRole("button", { name: "Lưu giao dịch" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
  expect(deals(sent)?.body).toMatchObject({
    deal: "buy",
    source: "invoice",
    settled_now: true,
    title: "Bán token tháng 10",
    partner_name: "Công ty TNHH Bao Bì Phương Nam",
    start_date: "2026-10-18",
    end_date: null,
    notice_days: null,
    total_value: 1_500_000,
  });
  expect(sent.some((s) => s.path.endsWith("/manual"))).toBe(false);
});

test("không tích «đã giao» ⇒ không gửi settled_now", async ({ page }) => {
  const sent = await install(page);
  await page.goto("/contracts/new?type=deal");
  await fillDeal(page, "verbal");
  await page.getByRole("button", { name: "Lưu giao dịch" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
  const body = deals(sent)?.body as Record<string, unknown>;
  expect(body.source).toBe("verbal");
  expect("settled_now" in body).toBe(false);
});

test("thiếu nguồn ⇒ chặn lưu, báo, viền đỏ; không gửi", async ({ page }) => {
  const sent = await install(page);
  await page.goto("/contracts/new?type=deal");
  await fillDeal(page, null);
  await page.getByRole("button", { name: "Lưu giao dịch" }).click();
  await expect(page.getByRole("alert")).toHaveText("Chọn nguồn giao dịch.");
  await expect(page.getByLabel(/^Nguồn giao dịch/)).toHaveAttribute("aria-invalid", "true");
  expect(deals(sent)).toBeUndefined();
});

test("xác nhận ngay dừng giữa chừng (settle_error) ⇒ ở lại báo lý do, giao dịch đã lưu, có nút mở", async ({
  page,
}) => {
  await install(page, "STOCK_INSUFFICIENT");
  await page.goto("/contracts/new?type=deal");
  await fillDeal(page);
  await page.getByLabel(/^Đã giao \/ đã thanh toán ngay/).check();
  await page.getByRole("button", { name: "Lưu giao dịch" }).click();
  const err = page.getByTestId("settle-error");
  await expect(err).toContainText("Giao dịch đã được lưu");
  await expect(err).toContainText("Không đủ tồn kho");
  await expect(page).toHaveURL(/\/contracts\/new/);
  await expect(page.getByRole("link", { name: "Mở giao dịch" })).toHaveAttribute(
    "href",
    `/contracts/${NEW_ID}`,
  );
});

test("?frame=<id> điền sẵn HĐ nguyên tắc; lưu xong gắn qua POST /attach", async ({ page }) => {
  const sent = await install(page);
  await page.goto(`/contracts/new?type=deal&frame=${ACTIVE_ID}`);
  const picked = page.getByTestId("frame-picked");
  await expect(picked).toBeVisible();
  await expect(picked).not.toHaveText("");
  await fillDeal(page);
  await page.getByRole("button", { name: "Lưu giao dịch" }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
  const attach = sent.find((s) => s.path.endsWith(`/${ACTIVE_ID}/attach`));
  expect(attach?.body).toEqual({ ids: [NEW_ID] });
});

test("/transactions/new và /transactions/<id> chuyển hướng", async ({ page }) => {
  await install(page);
  await page.goto("/transactions/new");
  await expect(page).toHaveURL(/\/contracts\/new\?type=deal/);
  await page.goto(`/transactions/${ACTIVE_ID}`);
  await expect(page).toHaveURL(new RegExp(`/contracts/${ACTIVE_ID}$`));
});

test("cảnh báo pháp lý (Câu 8): đứng riêng, giá trị ≥ ngưỡng, còn mốc mở ⇒ cảnh báo, không chặn lưu; có HĐ NT / đã giao ngay ⇒ không", async ({
  page,
}) => {
  const sent = await install(page);
  await page.goto("/contracts/new?type=deal");
  await fillDeal(page);
  const warn = page.getByTestId("legal-warning");
  await expect(warn).toHaveCount(0); // 1.500.000 < 5.000.000
  await page.getByLabel("Giá trị").fill("6000000");
  await expect(warn).toContainText("Cần kế toán xác nhận");
  await page.getByLabel(/^Đã giao \/ đã thanh toán ngay/).check();
  await expect(warn).toHaveCount(0);
  await page.getByLabel(/^Đã giao \/ đã thanh toán ngay/).uncheck();
  await expect(warn).toBeVisible();
  await page.getByRole("button", { name: "Lưu giao dịch" }).click(); // chỉ cảnh báo, không chặn
  await expect(page).toHaveURL(new RegExp(`/contracts/${NEW_ID}$`));
  expect(deals(sent)?.body).toMatchObject({ total_value: 6_000_000 });
});

test("cảnh báo pháp lý không áp khi giao dịch thuộc HĐ nguyên tắc (?frame=)", async ({ page }) => {
  await install(page);
  await page.goto(`/contracts/new?type=deal&frame=${ACTIVE_ID}`);
  await fillDeal(page);
  await page.getByLabel("Giá trị").fill("6000000");
  await expect(page.getByTestId("legal-warning")).toHaveCount(0);
});
