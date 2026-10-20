// V2-G · HD-02/HD-08 · BA §4.2 "Upload và xác nhận" · 5.5 · Luật 4b: màn xác nhận sau khi AI đọc — form V2-F điền sẵn, ô AI chưa chắc tô vàng, mốc AI
// tìm thấy ở cột phải, gợi ý SP theo quy tắc nhận diện, Lưu = MỘT POST /review, Hủy không gửi gì, tenant tắt duyệt ⇒ HĐ có hiệu lực; khối Sản phẩm của
// HĐ đã lưu gắn lại SP (PUT) và Tóm tắt hiện 5 mục AI. Backend giả `page.route`; chờ phần tử/yêu cầu, không sleep.
import { expect, type Page, test } from "@playwright/test";
import { ACTIVE_ID, P_TOKEN } from "./dataset-v2f";
import { ITEM1, ITEM2, NEW_PRODUCT_ID, P_USB, REVIEW_ID } from "./dataset-v2g";
import type { Sent } from "./v2f-support";
import { installV2g } from "./v2g-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const writes = (sent: Sent[]) => sent.filter((s) => s.method !== "GET");
const review = (sent: Sent[]) => sent.filter((s) => s.path.endsWith("/review"));

async function openReview(page: Page, init: Parameters<typeof installV2g>[1] = {}) {
  const ctx = await installV2g(page, init);
  await page.goto(`/contracts/${REVIEW_ID}`);
  await expect(page.getByTestId("review-items")).toBeVisible();
  // Gợi ý SP đến muộn: dòng 1 ("USB") được chọn sẵn theo quy tắc nhận diện, dòng 2 đề xuất tạo mới.
  await expect(page.getByLabel("Gắn dòng 1 với sản phẩm")).toHaveValue(P_USB.id);
  await expect(page.getByLabel("Gắn dòng 2 với sản phẩm")).toHaveValue("__new__");
  return ctx;
}

test("ô AI chưa chắc tô vàng (đối tác, điều khoản TT, loại HĐ), ô chắc chắn thì không", async ({
  page,
}) => {
  await openReview(page);
  await expect(page.locator("#cf-payment_terms")).toHaveAttribute("data-unsure", "true");
  await expect(page.locator("#cf-partner")).toHaveAttribute("data-unsure", "true");
  await expect(page.getByRole("radiogroup")).toHaveAttribute("data-unsure", "true");
  await expect(page.locator("#cf-number")).not.toHaveAttribute("data-unsure", "true");
  // người sửa ô ⇒ hết tô vàng
  await page.locator("#cf-payment_terms").fill("Chuyển khoản trong 15 ngày");
  await expect(page.locator("#cf-payment_terms")).not.toHaveAttribute("data-unsure", "true");
});

test("cột phải: mốc AI tìm thấy (giữ/bỏ, hạn theo ngày HĐ khi AI không thấy ngày) + gợi ý SP theo quy tắc", async ({
  page,
}) => {
  await openReview(page);
  const list = page.getByTestId("ai-milestones");
  await expect(list.getByText("Giao hàng đợt 1", { exact: true })).toBeVisible();
  await expect(list.getByText("Thanh toán 50%", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Hạn mốc Giao hàng đợt 1")).toHaveValue("2026-03-01");
  await expect(page.getByLabel("Hạn mốc Thanh toán 50%")).toHaveValue("2026-12-31");
  await expect(page.getByTestId("link-0").getByText("Gợi ý")).toBeVisible();
  await expect(page.getByLabel("Gắn dòng 1 với sản phẩm").locator("option:checked")).toHaveText(
    "Chữ ký số DN – USB Token",
  );
});

test("Lưu = MỘT POST /review (trường + loại + dòng + mốc giữ lại); SP mới tạo trước", async ({
  page,
}) => {
  const { sent } = await openReview(page);
  await page.getByLabel("Giữ mốc Giao hàng đợt 1").uncheck();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu hợp đồng");
  expect(review(sent)).toHaveLength(1);
  expect(sent.filter((s) => s.path === "/pack/contracts/products")).toHaveLength(1);
  expect(review(sent)[0]).toEqual({
    method: "POST",
    path: `/pack/contracts/contracts/${REVIEW_ID}/review`,
    body: {
      version: 3,
      deal: "sell",
      items: [
        {
          id: ITEM1,
          name: "USB",
          unit: "cái",
          qty: 100,
          unit_price: 250_000,
          product_id: P_USB.id,
          component_ids: [P_USB.components[0]?.id],
        },
        {
          id: ITEM2,
          name: "Phí dịch vụ lạ",
          unit: "gói",
          qty: 1,
          unit_price: 5_000_000,
          product_id: NEW_PRODUCT_ID,
        },
      ],
      milestones: [
        { kind: "collect", title: "Thanh toán 50%", due_date: "2026-12-31", amount: 122_500_000 },
      ],
    },
  });
});

test("đổi Bán → Mua: đối tác dựng lại theo bên bán, gửi deal=buy, không có trường 'đổi ảo'", async ({
  page,
}) => {
  const { sent } = await openReview(page);
  await page.getByRole("radio", { name: /^Mua/ }).click();
  await expect(page.getByLabel(/^Nhà cung cấp/)).toHaveValue("Công ty TNHH Bao Bì Phương Nam");
  await expect(page.getByLabel("Gắn dòng 1 với sản phẩm")).toHaveValue(P_USB.id); // gợi ý chạy lại theo loại mới
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const b = review(sent)[0]?.body as { deal: string; fields?: unknown };
  expect(b.deal).toBe("buy");
  expect(b.fields).toBeUndefined();
});

test("Hủy = bỏ chỉnh sửa, KHÔNG gửi yêu cầu ghi nào", async ({ page }) => {
  const { sent } = await openReview(page);
  await page.locator("#cf-title").fill("Tên đã sửa");
  await page.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator("#cf-title")).toHaveValue("Hợp đồng mua bán bao bì 2026");
  expect(writes(sent)).toEqual([]);
});

test("dòng chưa gắn SP chặn Lưu (5.5a) — không gửi /review", async ({ page }) => {
  const { sent } = await openReview(page);
  await page.getByLabel("Gắn dòng 2 với sản phẩm").selectOption("");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText("chưa gắn sản phẩm");
  expect(review(sent)).toHaveLength(0);
});

test("tenant tắt duyệt: Lưu trả `active` ⇒ trang chi tiết thường, hết thanh Huỷ/Lưu dính", async ({
  page,
}) => {
  await openReview(page, { saveStatus: "active" });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu — hợp đồng có hiệu lực");
  await expect(page.getByTestId("form-bar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lưu thay đổi" })).toBeVisible();
});

test("chi tiết đã lưu: gắn lại SP cho dòng (PUT) + 409 ITEM_LOCKED báo câu riêng", async ({
  page,
}) => {
  const { sent, st } = await installV2g(page);
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByLabel("Gắn dòng 1 với sản phẩm").selectOption(P_TOKEN.id);
  await expect.poll(() => writes(sent).filter((s) => s.method === "PUT").length).toBe(1);
  expect(writes(sent).find((s) => s.method === "PUT")).toEqual({
    method: "PUT",
    path: `/pack/contracts/contracts/${ACTIVE_ID}/items/e1000000-0000-4000-8000-000000000001/product`,
    body: { product_id: P_TOKEN.id },
  });
  st.locked = true;
  await page.getByLabel("Gắn dòng 2 với sản phẩm").selectOption(P_TOKEN.id);
  await expect(page.getByRole("alert").first()).toContainText("đã phát sinh kho");
});

test("Tóm tắt hiện 5 mục AI viết", async ({ page }) => {
  await installV2g(page);
  await page.goto(`/contracts/${ACTIVE_ID}`);
  const s = page.getByTestId("ai-summary");
  await expect(s.getByTestId("ai-sum-main")).toContainText("Hợp đồng bán bao bì");
  await expect(s.getByTestId("ai-sum-aiSumDeadlines")).toContainText("Giao đợt 1 trước 01/03/2026");
  await expect(s.getByTestId("ai-sum-aiSumPenalties")).toContainText("Phạt 0,05%/ngày");
  await expect(s.getByTestId("ai-sum-aiSumBonuses")).toBeVisible();
  await expect(s.getByTestId("ai-sum-aiSumClauses")).toContainText("Điều 5");
  for (const h of ["Nội dung chính", "Hạn quan trọng", "Phạt", "Thưởng", "Điều khoản chính"])
    await expect(s.getByRole("heading", { name: h, exact: true })).toBeVisible();
});
