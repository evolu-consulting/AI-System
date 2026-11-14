// CR-157 · «Nhập tay» = dự phòng khi AI đọc lỗi/hết giờ: nhập ngay trên HĐ đó (không còn dẫn sang trang tạo trống), người nhập tích
// «Tôi đã đối chiếu với tệp gốc», nhãn «Nhập tay · cần đối chiếu» / «… đã đối chiếu bởi X». Backend giả `page.route`; không sleep.
// Viết, chưa chạy (điều phối chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const failed = () => ({
  ...activeContract(),
  status: "draft",
  effect: null,
  extract_state: "failed",
  error: "TIMEOUT",
  submit_round: 0,
  milestones: [],
});
const manual = (reconciled = false) => ({
  ...failed(),
  extract_state: "ready",
  error: null,
  entry_source: "manual",
  reconciled_by: reconciled ? "11111111-1111-4111-8111-111111111111" : null,
  reconciled_at: reconciled ? "2026-10-18T01:00:00.000Z" : null,
});

test("Đọc lỗi: Nhập tay là nút trên chính HĐ, bấm gọi manual-entry và hiện nhãn cần đối chiếu", async ({
  page,
}) => {
  let state: "failed" | "manual" = "failed";
  const sent = await installV2f(page, {
    contract: () => (state === "failed" ? failed() : manual()),
  });
  await page.route(`**/contracts/${ACTIVE_ID}/manual-entry`, async (r) => {
    state = "manual";
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: ACTIVE_ID,
        status: "draft",
        extract_state: "ready",
        entry_source: "manual",
        version: 2,
      }),
    });
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await expect(page.getByRole("link", { name: "Nhập tay" })).toHaveCount(0);
  await page.getByTestId("manual-entry").click();
  await expect.poll(() => sent.filter((s) => s.path.endsWith("/manual-entry")).length).toBe(1);
  await expect(page.getByTestId("manual-tag")).toHaveText("Nhập tay · cần đối chiếu");
  await expect(page.getByTestId("manual-reconciled")).not.toBeChecked();
});

test("Nhập tay chưa đối chiếu: tích ô «Tôi đã đối chiếu với tệp gốc» gọi PUT reconcile", async ({
  page,
}) => {
  const sent = await installV2f(page, { contract: () => manual() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await page.getByTestId("manual-reconciled").check();
  await expect.poll(() => sent.filter((s) => s.path.endsWith("/reconcile")).length).toBe(1);
  expect(sent.find((s) => s.path.endsWith("/reconcile"))?.body).toEqual({ reconciled: true });
});

test("Nhập tay đã đối chiếu: nhãn có tên người đối chiếu, người xem chỉ thấy nhãn không có ô tích", async ({
  page,
}) => {
  await installV2f(page, { role: "viewer", contract: () => manual(true) });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await expect(page.getByTestId("manual-tag")).toContainText("Nhập tay · đã đối chiếu");
  await expect(page.getByTestId("manual-reconciled")).toHaveCount(0);
});

// CR-157b · nút Xác nhận & lưu / Gửi duyệt tắt tới khi tích đối chiếu; tệp gốc cạnh form (desktop); Tải tệp khác thay tệp.
test("Nhập tay chưa đối chiếu: nút Xác nhận và lưu tắt, tích xong thì bật", async ({ page }) => {
  let rec = false;
  await installV2f(page, { contract: () => manual(rec) });
  await page.route(`**/contracts/${ACTIVE_ID}/reconcile`, async (r) => {
    rec = true;
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: ACTIVE_ID,
        reconciled_by: "11111111-1111-4111-8111-111111111111",
        reconciled_at: "2026-10-18T01:00:00.000Z",
      }),
    });
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  const go = page.getByTestId(/^(confirm-save|act-approvalConfirm|act-resubmit)$/).first();
  await expect(go).toBeDisabled();
  await page.getByTestId("manual-reconciled").check();
  await expect(go).toBeEnabled();
});

test("Nhập tay trên màn rộng: tệp gốc hiện cạnh form", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installV2f(page, { contract: () => manual() });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await expect(page.getByTestId("manual-side")).toBeVisible();
});

test("Đọc lỗi: Tải tệp khác gửi tệp tới replace-file", async ({ page }) => {
  await installV2f(page, { contract: () => failed() });
  const calls: string[] = [];
  await page.route(`**/contracts/${ACTIVE_ID}/replace-file`, async (r) => {
    calls.push(r.request().method());
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: ACTIVE_ID,
        status: "draft",
        extract_state: "reading",
        version: 3,
      }),
    });
  });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await page
    .getByTestId("replace-file")
    .locator("input[type=file]")
    .setInputFiles({
      name: "moi.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
  await expect.poll(() => calls.length).toBe(1);
});
