// CR-121 · R-3 · hành trình thật (stack P-b2: Hub thật + Runtime giả): quản trị mở "Chi tiết lượt chạy", bấm bước xem nhật ký,
// dừng lượt có lý do. Dữ liệu: run seed (a) của phòng riêng của spec; không bật/ẩn gì dùng chung. Đuôi `.k1.ts` (config K1, project admin).

import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_URL } from "../../P-a/_pa-support";
import { adminLogin, DEF_PAR, mkRoom, seedPb2Run, settle, withSql } from "../../P-b2/_pb2-support";
import { seedAdmin } from "../../support/helpers";

test.afterEach(() => settle());

// Stack K1 = P-b2: `platformLogin` của P-b trỏ cổng admin của P-b (4605, không chạy ở đây) ⇒ đăng nhập platform_admin qua ADMIN_URL của stack này.
async function platformLogin(p: Page): Promise<void> {
  const a = seedAdmin();
  await p.goto(`${ADMIN_URL}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(a.username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(a.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}

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

test("CR-121 Q-3 · platform_admin mở lượt chạy gắn hợp đồng của công ty acme ⇒ thấy nút 'Mở lại quy trình', thẻ bắt buộc nhập lý do (≤ 500) mới cho xác nhận", async ({
  page,
}) => {
  const room = await mkRoom("EC121-RUN3");
  const r = await seedPb2Run(room.id, "a");
  // Lượt của run seed gắn vào một hợp đồng (nguồn `contract`) — dữ liệu riêng của spec, không đụng run dùng chung.
  await withSql(
    (sql) =>
      sql`update hub.process_runs set pack_key = 'contracts', pack_record_id = ${randomUUID()} where id = ${r.runId}`,
  );
  await page.addInitScript(() => sessionStorage.setItem("ai.process.tenant", "acme"));
  await platformLogin(page);
  await page.goto(`/processes/${DEF_PAR.id}/runs/${r.runId}`);
  const reopen = page.getByTestId("run-reopen");
  await expect(reopen).toBeVisible();
  await expect(reopen).toHaveText("Mở lại quy trình");
  await reopen.click();
  const dlg = page.getByRole("dialog", { name: "Mở lại quy trình của hợp đồng?" });
  const confirm = dlg.getByTestId("control-confirm");
  await expect(confirm).toBeDisabled();
  const reason = dlg.getByRole("textbox", { name: "Lý do mở lại (bắt buộc)" });
  await reason.fill("   ");
  await expect(confirm).toBeDisabled();
  await reason.fill("x".repeat(501));
  await expect(confirm).toBeDisabled();
  await reason.fill("Khách yêu cầu sửa điều khoản thanh toán");
  await expect(confirm).toBeEnabled();
});
