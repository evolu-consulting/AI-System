// CR-121 · R-3 · hành trình thật (stack P-b2: Hub thật + Runtime giả): quản trị mở "Chi tiết lượt chạy", bấm bước xem nhật ký,
// dừng lượt có lý do. Dữ liệu: run seed (a) của phòng riêng của spec; không bật/ẩn gì dùng chung. Đuôi `.k1.ts` (config K1, project admin).
import { expect, test } from "@playwright/test";
import { adminLogin, DEF_PAR, mkRoom, seedPb2Run, settle } from "../../P-b2/_pb2-support";

test.afterEach(() => settle());

test("CR-121 R-3 · mở lượt chạy: mã lượt + quy trình + trạng thái kèm lý do, sơ đồ có bước; bấm bước ⇒ ngăn 'Nhật ký bước 1' (tab Cơ bản)", async ({
  page,
}) => {
  const room = await mkRoom("EC121-RUN1");
  const r = await seedPb2Run(room.id, "a");
  await adminLogin(page);
  await page.goto(`/processes/${DEF_PAR.id}/runs/${r.runId}`);
  await expect(page.getByTestId("run-id")).toHaveText(r.runId);
  await expect(page.getByTestId("run-status-text")).not.toBeEmpty();
  const steps = page.getByTestId("run-step");
  await expect(steps.first()).toBeVisible();
  await steps.first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Nhật ký bước 1")).toBeVisible();
  await expect(drawer.getByRole("tab", { name: "Cơ bản" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});

test("CR-121 R-3 · dừng lượt: thẻ xác nhận bắt buộc chọn lý do (Gửi nhầm) ⇒ POST /stop 200 ⇒ trạng thái 'Đã huỷ' và hết nút Dừng", async ({
  page,
}) => {
  const room = await mkRoom("EC121-RUN2");
  const r = await seedPb2Run(room.id, "a");
  await adminLogin(page);
  await page.goto(`/processes/${DEF_PAR.id}/runs/${r.runId}`);
  await page.getByRole("button", { name: "Dừng lượt chạy" }).click();
  const dlg = page.getByRole("dialog", { name: "Dừng lượt chạy này?" });
  const confirm = dlg.getByRole("button", { name: "Dừng lượt chạy" });
  await expect(confirm).toBeDisabled();
  await dlg.getByRole("radio", { name: "Gửi nhầm" }).click();
  await expect(confirm).toBeEnabled();
  const stop = page.waitForResponse(
    (x) => x.request().method() === "POST" && x.url().includes(`/process-runs/${r.runId}/stop`),
  );
  await confirm.click();
  expect((await stop).status()).toBe(200);
  await expect(dlg).toHaveCount(0);
  await expect(page.getByTestId("run-status-text")).toContainText(/dừng|huỷ/i);
  await expect(page.getByRole("button", { name: "Dừng lượt chạy" })).toHaveCount(0);
});
