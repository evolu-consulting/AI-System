// AC-H29 · T8 · HUB-FR-113 · e2e P-a PF3 ⇢PF1 · E-P18 (test-plan-e2e §2): T (ngoài phòng) bấm "Đạt" ở `/runs/<id>?task=` ⇒ B
// (đang mở thread, không reload) thấy `article "Thomas · Đạt · …"` có chữ "ngoài phòng"; T không có link tới phòng/thread;
// huy hiệu chưa đọc phòng R của X tăng (như tin thread X2b).
import { expect, test } from "@playwright/test";
import {
  badgeOf,
  flowPane,
  mkRoom,
  passBtn,
  seedRun,
  settle,
  taskResult,
  users,
} from "../_pa-support";

test.afterEach(() => settle());

test('AC-H29 · T8 · E-P18 · T Đạt ở /runs/<id>?task= ⇒ B (thread mở) thấy "Thomas · Đạt · …" + "ngoài phòng"; T không có link phòng/thread; huy hiệu chưa đọc R của X tăng', async ({
  browser,
}) => {
  const room = await mkRoom("EP18");
  const other = await mkRoom("EP18-khac", ["X"]);
  const r = await seedRun(room.id, "waiting_review");
  const u = await users(browser, "B", "T", "X");
  try {
    await u.B.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    await expect(flowPane(u.B)).toBeVisible();
    await u.X.goto(`/rooms/${other.id}`);

    await u.T.goto(`/runs/${r.runId}?task=${r.taskId ?? ""}`);
    await expect(u.T.getByRole("link", { name: /Mở luồng trong phòng|Quay lại/ })).toHaveCount(0);
    await passBtn(u.T.getByRole("region", { name: "Kiểm Đọc hoá đơn" })).click();

    const msg = taskResult(flowPane(u.B), "Thomas", "Đạt");
    await expect(msg).toBeVisible();
    await expect(msg).toContainText("ngoài phòng");
    await expect(badgeOf(u.X, room.name)).toBeVisible();
  } finally {
    await u.close();
  }
});
