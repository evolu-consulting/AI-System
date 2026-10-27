// CR-097 K3a · HD-FR-100 · HD-FR-104 · Luật 4b: HĐ đã khoá — trường pháp lý chỉ đọc + banner "Đã xác nhận — đã khoá"; owner mở lại có lý do;
// người không phải owner không thấy link; Chờ duyệt có banner "Chưa xác nhận"; danh sách: 🔒, không còn "Thêm thủ công".
// Backend giả `page.route`; không sleep.
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

/** CR-101a: người phụ trách khác người đang xem (editor phụ trách thấy «Mở lại» — xem k4-reopen.cw.ts). */
const OTHER = "a1000000-0000-4000-8000-000000000099";
const locked = (over: object = {}) =>
  activeContract({
    locked: true,
    locked_at: "2026-10-17T02:00:00.000Z",
    locked_by: "u1000000-0000-4000-8000-000000000001",
    ...over,
  });

test("HĐ khoá tuyệt đối: mọi ô (cả notice_days) chỉ đọc, ẩn Lưu thay đổi / + Thêm mốc / Sửa mốc, không khoảng trống giữa banner và Hạn chót", async ({
  page,
}) => {
  await installV2f(page, { role: "editor", contract: () => locked({ owner_user_id: OTHER }) });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  const banner = page.getByTestId("banner-locked");
  await expect(banner).toContainText("Đã xác nhận — đã khoá");
  await expect(page.getByTestId("lock-badge")).toBeVisible();
  const upd = banner.getByRole("button", { name: "Tải bản cập nhật" });
  await expect(upd).toBeEnabled(); // K3b: bật nút tải bản cập nhật
  await expect(page.getByLabel("Giá trị")).toBeDisabled();
  await expect(page.getByLabel("Tên hợp đồng")).toBeDisabled();
  await expect(page.getByLabel(/^Nhắc trước/)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Lưu thay đổi" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Thêm mốc" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Sửa mốc/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Văn bản gốc" })).toHaveCount(0);
  await expect(page.getByTestId("reopen-link")).toHaveCount(0);
  // F: không còn khối thông báo rỗng / giữ chỗ giữa banner khoá và "Hạn chót hành động".
  await expect(page.locator("p[role=status], p[role=alert]")).toHaveCount(0);
});

test("mở lại (tenant tắt duyệt): «Xác nhận và lưu» hiện ⇒ bấm ⇒ POST /review (không draft) ⇒ khoá lại", async ({
  page,
}) => {
  let confirmed = false;
  const posts: unknown[] = [];
  await installV2f(page, {
    role: "owner",
    contract: () => (confirmed ? locked() : activeContract({ status: "needs_review" })),
  });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/approval`, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: null,
        run_status: null,
        step: null,
        task_id: null,
        can_act: false,
        feedback: null,
      }),
    }),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/review`, (r) => {
    posts.push(r.request().postDataJSON());
    confirmed = true;
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: ACTIVE_ID,
        status: "active",
        version: 5,
        items: 0,
        milestones: 0,
      }),
    });
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByRole("button", { name: "Lưu nháp", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận và lưu" }).click();
  // atomic-confirm: HĐ có dòng ⇒ hộp "Gắn sản phẩm" ⇒ MỘT POST /review mang `products` (không gọi /product-links sau khoá).
  await page.getByTestId("product-link-confirm").click();
  await expect(page.getByTestId("banner-locked")).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).not.toHaveProperty("draft");
  expect(posts[0]).toHaveProperty("products");
});

test("HĐ khoá, editor không phụ trách, không phải owner: không thấy «Mở lại»", async ({ page }) => {
  await installV2f(page, { role: "editor", contract: () => locked({ owner_user_id: OTHER }) });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("banner-locked")).toBeVisible();
  await expect(page.getByText("Mở lại để sửa lỗi trích xuất")).toHaveCount(0);
});

test("owner: «Mở lại» ⇒ hộp thoại bắt buộc lý do ⇒ POST /reopen {reason} rồi tải lại (Chờ duyệt)", async ({
  page,
}) => {
  let reopened = false;
  const sent = await installV2f(page, {
    role: "owner",
    contract: () => (reopened ? activeContract({ status: "needs_review" }) : locked()),
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByText("Mở lại để sửa lỗi trích xuất").click();
  const dlg = page.getByRole("dialog", { name: "Mở lại hợp đồng" });
  const ok = dlg.getByTestId("reopen-confirm");
  await expect(ok).toBeDisabled();
  await dlg.getByLabel(/^Lý do mở lại/).fill("AI đọc sai giá trị hợp đồng");
  reopened = true;
  await ok.click();
  await expect(page.getByTestId("banner-locked")).toHaveCount(0);
  await expect(page.getByTestId("banner-pending")).toContainText("Chưa xác nhận");
  expect(sent.find((s) => s.path.endsWith("/reopen"))).toEqual({
    method: "POST",
    path: `/pack/contracts/contracts/${ACTIVE_ID}/reopen`,
    body: { reason: "AI đọc sai giá trị hợp đồng" },
  });
});

test("HĐ chờ duyệt: banner «Chưa xác nhận», không khoá ô", async ({ page }) => {
  await installV2f(page, { contract: () => activeContract({ status: "needs_review" }) });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("banner-pending")).toContainText("Chưa xác nhận");
  await expect(page.getByTestId("banner-locked")).toHaveCount(0);
  await expect(page.getByLabel("Giá trị")).toBeEnabled();
});

test("HĐ không có văn bản: nhãn «Chưa có văn bản»", async ({ page }) => {
  await installV2f(page, { contract: () => activeContract({ has_document: false }) });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("no-document")).toHaveText("Chưa có văn bản");
});

test("danh sách: không còn «Thêm thủ công»; hàng đã xác nhận có 🔒", async ({ page }) => {
  await installV2f(page);
  await page.goto("/contracts");
  await expect(page.getByRole("button", { name: "Upload hợp đồng" })).toBeVisible();
  await expect(page.getByText("Thêm thủ công")).toHaveCount(0);
  await expect(page.getByTestId("row-lock").first()).toBeVisible();
});
