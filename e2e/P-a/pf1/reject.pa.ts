// N2-FR-02 · HD-FR-36 · HD3 (chat-web nút Từ chối): B (Group Kế toán) ở thẻ kiểm bấm "Từ chối" ⇒ ô lý do bắt buộc (nút gửi tắt
// khi trống) ⇒ "Sai MST" ⇒ tin kết quả "Hoa · Từ chối" kèm lý do, thẻ kiểm biến mất, lượt chạy kết thúc (không còn Đạt/Chưa đạt).
import { expect, test } from "@playwright/test";
import {
  failBtn,
  flowPane,
  mkRoom,
  openThread,
  outputMsg,
  passBtn,
  rtScript,
  settle,
  startUi,
  taskResult,
  users,
} from "../_pa-support";

test.afterEach(() => settle());

test('N2-FR-02 · HD3 · B "Từ chối" ⇒ lý do bắt buộc; "Sai MST" ⇒ tin "Hoa · Từ chối" + lý do, hết nút kiểm', async ({
  browser,
}) => {
  const room = await mkRoom("HD3R");
  const u = await users(browser, "A", "B");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    const { runId } = await startUi(u.A, "!hoa-don-t HD-9");
    await rtScript(runId, 0, [{ kind: "done", tag: "v1" }, { kind: "hold" }]);
    await openThread(u.B, room.id);
    const pane = flowPane(u.B);
    await expect(outputMsg(pane)).toBeVisible();
    const card = pane.getByRole("region", { name: "Kiểm Đọc hoá đơn" });
    await card.getByRole("button", { name: "Từ chối", exact: true }).click();
    const reason = card.getByRole("textbox", { name: "Lý do từ chối (bắt buộc)" });
    await expect(reason).toBeFocused();
    const send = card.getByRole("button", { name: "Từ chối · kết thúc lượt chạy" });
    await expect(send).toBeDisabled();
    await reason.fill("Sai MST");
    await send.click();
    const res = taskResult(pane, "Hoa", "Từ chối");
    await expect(res).toBeVisible();
    await expect(res).toContainText("Sai MST");
    await expect(passBtn(pane)).toHaveCount(0);
    await expect(failBtn(pane)).toHaveCount(0);
  } finally {
    await u.close();
  }
});
