// CHAT-AC-55 · HUB-FR-112 · e2e P-a PF3 ⇢PF1 (`ReviewTaskCard`) · E-P12 (test-plan-e2e §2; plan-frontend-e2e §1 DM
// `/process-inbox`): T (ngoài phòng) — `link "Quy trình"` + huy hiệu `process-dm-badge`; trang: heading "Quy trình", `log
// "Thông báo quy trình"`, thẻ "Cần bạn kiểm: Hoá đơn T · Đọc hoá đơn" có region "Kiểm …" + Đạt/Chưa đạt; không textbox trong
// main; T Đạt ⇒ thẻ "Bạn · Đạt"; mở trang ⇒ huy hiệu về 0.
import { expect, test } from "@playwright/test";
import { mkRoom, passBtn, seedRun, settle, users, withSql } from "../_pa-support";

test.afterEach(() => settle());

test('CHAT-AC-55 · E-P12 · T: link "Quy trình" có huy hiệu; /process-inbox có thẻ "Cần bạn kiểm: Hoá đơn T · Đọc hoá đơn" + Đạt/Chưa đạt, không textbox; Đạt ⇒ "Bạn · Đạt"; huy hiệu về 0', async ({
  browser,
}) => {
  const room = await mkRoom("EP12");
  const r = await seedRun(room.id, "waiting_review");
  if (r.ready)
    // thông báo `review_requested` cho T (PF1 ghi khi mở task; fixture ghi trực tiếp cho PF3)
    await withSql(
      (
        sql,
      ) => sql`insert into hub.process_notices (tenant_id, user_id, kind, process_run_id, task_id, payload)
        select pr.tenant_id, u.id, 'review_requested', pr.id, ${r.taskId}, ${sql.json({
          process_name: "Hoá đơn T",
          stage_name: "Đọc hoá đơn",
        })}
        from hub.process_runs pr, admin.users u where pr.id = ${r.runId} and u.username = 'cuc' and u.tenant_id = pr.tenant_id`,
    );
  const u = await users(browser, "T");
  try {
    const p = u.T;
    const link = p.getByRole("link", { name: "Quy trình", exact: true });
    await expect(link).toBeVisible();
    await expect(link.getByTestId("process-dm-badge")).toBeVisible();
    await link.click();
    await expect(p).toHaveURL(/\/process-inbox$/);
    await expect(p.getByRole("heading", { name: "Quy trình" })).toBeVisible();
    const log = p.getByRole("log", { name: "Thông báo quy trình" });
    await expect(
      p.getByText(/Đây là kênh thông báo của quy trình, không nhắn trả lời được/),
    ).toBeVisible();
    await expect(p.getByRole("main").getByRole("textbox")).toHaveCount(0);
    const card = log.getByRole("article", { name: "Cần bạn kiểm: Hoá đơn T · Đọc hoá đơn" });
    const reg = card.getByRole("region", { name: /^Kiểm / });
    await expect(reg.getByRole("button", { name: "Chưa đạt", exact: true })).toBeVisible();
    await passBtn(reg).click();
    await expect(card.getByText(/Bạn · Đạt/i)).toBeVisible();
    await expect(link.getByTestId("process-dm-badge")).toBeHidden();
  } finally {
    await u.close();
  }
});
