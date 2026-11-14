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
