// CHAT-AC-52 · U5 · HUB-BR-25 · e2e P-a PF1 · E-P20 (test-plan-e2e §2; plan-frontend-thread §4–§5): X (không assignee) mở
// thread: thấy mọi loại tin + "Đang chờ …", không nút; X rời R ⇒ thread 404 ⇒ URL bỏ `?flow`; < 640 px thread là
// `dialog "Flow đang mở"`. A (người bắt đầu) rời R ⇒ thread 404, nhưng `/runs/<id>` vẫn mở dạng ngoài phòng: banner `left`,
// `region "Kết quả"` ≥1 "Xem kết quả", "Huỷ lượt chạy", không `tab "Nhật ký"`, không link phòng.
import { expect, test } from "@playwright/test";
import {
  failBtn,
  flowPane,
  hub,
  mkRoom,
  outputMsg,
  PERSONA,
  passBtn,
  seedRun,
  settle,
  tok,
  users,
  waitingNote,
} from "../_pa-support";

test.afterEach(() => settle());

test('CHAT-AC-52 · U5 · E-P20 · X mở thread thấy tin + "Đang chờ …" không nút; < 640 px là dialog; X rời R ⇒ bỏ ?flow; A rời R ⇒ /runs/<id> dạng ngoài phòng (banner left, "Kết quả", "Huỷ lượt chạy", không "Nhật ký")', async ({
  browser,
}) => {
  const room = await mkRoom("EP20");
  const r = await seedRun(room.id, "waiting_review");
  const u = await users(browser, "A", "X");
  try {
    await u.X.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    const pane = flowPane(u.X);
    await expect(outputMsg(pane)).toBeVisible();
    await expect(waitingNote(pane, /Đang chờ .* kiểm/)).toBeVisible();
    await expect(passBtn(pane)).toHaveCount(0);
    await expect(failBtn(pane)).toHaveCount(0);

    await u.X.setViewportSize({ width: 375, height: 760 });
    await u.X.reload();
    await expect(u.X.getByRole("dialog", { name: "Flow đang mở" })).toBeVisible();
    await u.X.setViewportSize({ width: 1280, height: 800 });

    // X rời phòng ⇒ thread 404 ⇒ bỏ ?flow
    expect((await hub(await tok("X"), "POST", `/rooms/${room.id}/leave`)).status).toBeLessThan(300);
    await u.X.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    await expect(u.X).not.toHaveURL(/[?&]flow=/);
    await expect(outputMsg(u.X)).toHaveCount(0);

    // A (người bắt đầu, chủ phòng) chuyển chủ cho B rồi rời phòng
    const tr = await hub(await tok("A"), "POST", `/rooms/${room.id}/transfer`, {
      user_id: PERSONA.B.id,
    });
    expect(tr.status).toBeLessThan(300);
    expect((await hub(await tok("A"), "POST", `/rooms/${room.id}/leave`)).status).toBeLessThan(300);
    await u.A.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    await expect(u.A).not.toHaveURL(/[?&]flow=/);
    await u.A.goto(`/runs/${r.runId}`);
    await expect(
      u.A.getByText("Bạn không còn ở phòng này. Xem lượt chạy ở trang riêng."),
    ).toBeVisible();
    const out = u.A.getByRole("region", { name: "Kết quả" });
    await expect(out.getByRole("button", { name: "Xem kết quả" }).first()).toBeVisible();
    await expect(out).toContainText(/Kết quả giai đoạn Đọc hoá đơn · v1/);
    await expect(u.A.getByRole("button", { name: "Huỷ lượt chạy" })).toBeVisible();
    await expect(u.A.getByRole("tab", { name: "Nhật ký" })).toHaveCount(0);
    await expect(u.A.getByRole("link", { name: /Quay lại|Mở luồng trong phòng/ })).toHaveCount(0);
  } finally {
    await u.close();
  }
});
