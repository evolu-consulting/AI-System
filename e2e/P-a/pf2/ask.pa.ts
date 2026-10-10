// CHAT-AC-57 · AC-H30 · T6 · HUB-FR-110 · e2e P-a PF2 · E-P8 (test-plan-e2e §2; plan-frontend-thread §5): run `waiting_answer`
// (seedRun + tin thread `ask`): A bấm chip "09/2026" ⇒ gửi ngay ⇒ `article "Bạn · Đã trả lời · …"` chứa "09/2026"; "Trả lời
// bằng văn bản" ⇒ composer "Câu trả lời" + "Gửi trả lời"; X thấy câu hỏi + "Đang chờ … trả lời", chip không bấm được, không
// "Trả lời bằng văn bản". ⇢PF1: khối "Đang chạy" sau khi trả lời.
import { expect, test } from "@playwright/test";
import {
  block,
  flowPane,
  mkRoom,
  seedRun,
  settle,
  taskResult,
  users,
  waitingNote,
} from "../_pa-support";

test.afterEach(() => settle());

const askRegion = (scope: import("@playwright/test").Locator) =>
  scope.getByRole("region", { name: /cần thêm thông tin · lần hỏi 1\/3$/ });

test('CHAT-AC-57 · AC-H30 · E-P8 · A trả lời bằng chip ⇒ "Bạn · Đã trả lời" chứa lựa chọn; "Trả lời bằng văn bản" ⇒ "Câu trả lời" + "Gửi trả lời"; X chỉ thấy câu hỏi + "Đang chờ … trả lời"; ⇢PF1 khối "Đang chạy"', async ({
  browser,
}) => {
  const room = await mkRoom("EP8");
  const r = await seedRun(room.id, "waiting_answer");
  const r2 = await seedRun(room.id, "waiting_answer");
  const u = await users(browser, "A", "X");
  try {
    await u.X.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    const px = flowPane(u.X);
    const qx = askRegion(px);
    await expect(qx).toContainText("Kỳ kế toán nào?");
    await expect(waitingNote(px, /Đang chờ .* trả lời/)).toBeVisible();
    await expect(px.getByRole("button", { name: "Trả lời bằng văn bản" })).toHaveCount(0);
    const chipX = qx.getByRole("button", { name: "09/2026" });
    if (await chipX.count()) await expect(chipX).toBeDisabled();

    // văn bản (run 2)
    await u.A.goto(`/rooms/${room.id}?flow=${r2.flowId}`);
    const pa2 = flowPane(u.A);
    await askRegion(pa2).getByRole("button", { name: "Trả lời bằng văn bản" }).click();
    const box = pa2.getByRole("textbox", { name: "Câu trả lời" });
    await expect(box).toBeFocused();
    await box.fill("Tháng 9 năm 2026");
    await pa2.getByRole("button", { name: "Gửi trả lời" }).click();
    await expect(taskResult(pa2, "Bạn", "Đã trả lời")).toContainText("Tháng 9 năm 2026");

    // chip (run 1)
    await u.A.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    const pa = flowPane(u.A);
    await askRegion(pa).getByRole("button", { name: "09/2026" }).click();
    await expect(taskResult(pa, "Bạn", "Đã trả lời")).toContainText("09/2026");
    await expect(askRegion(pa)).toHaveCount(0);
    await expect(taskResult(px, "Lan Tran", "Đã trả lời")).toBeVisible();
    // ⇢PF1: stage chạy tiếp
    await expect(block(u.A).and(u.A.locator(`[data-run-id="${r.runId}"]`))).toContainText(
      "Đang chạy",
    );
  } finally {
    await u.close();
  }
});
