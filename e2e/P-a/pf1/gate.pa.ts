// CHAT-AC-53 · AC-H28 · T6 · T8 · HUB-FR-107 · e2e P-a PF1 · E-P4, E-P5 (test-plan-e2e §2; plan-frontend-thread §5): cổng kiểm
// trong thread. B (Group Kế toán, trong phòng) "Chưa đạt" ⇒ composer chế độ Góp ý (trống bị chặn) ⇒ gửi ⇒ tin kết quả task
// "Hoa · Chưa đạt · …" + góp ý, khối "Đang chạy", rồi "Kết quả … v2"; số tin `user` của thread không tăng (gọi API decision);
// X thấy tin kết quả nhưng không nút + "Đang chờ … kiểm". E-P5: B (thread) và T (ngoài phòng, `/runs/:id?task=`) bấm gần đồng
// thời ⇒ người sau "Đã có người khác quyết"; thread đúng 1 tin kết quả task.
import { expect, test } from "@playwright/test";
import {
  block,
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
  userMsgsInFlow,
  users,
  waitingNote,
} from "../_pa-support";

test.afterEach(() => settle());

test('CHAT-AC-53 · AC-H28 · E-P4 · B "Chưa đạt" ⇒ góp ý trống bị chặn; "Thiếu MST" ⇒ tin "Hoa · Chưa đạt" + góp ý, khối "Đang chạy", rồi v2; số tin user thread không tăng; X không có Đạt/Chưa đạt, thấy "Đang chờ … kiểm"', async ({
  browser,
}) => {
  const room = await mkRoom("EP4");
  const u = await users(browser, "A", "B", "X");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    const { runId, flowId } = await startUi(u.A, "!hoa-don-t HD-4");
    await rtScript(runId, 0, [{ kind: "done", tag: "v1" }, { kind: "hold" }]);
    await openThread(u.B, room.id);
    const pane = flowPane(u.B);
    await expect(outputMsg(pane)).toBeVisible();
    const card = pane.getByRole("region", { name: "Kiểm Đọc hoá đơn" });
    await expect(card).toBeVisible();
    await expect(pane.getByRole("textbox", { name: /sửa|chỉnh/i })).toHaveCount(0);
    const userBefore = await userMsgsInFlow("A", room.id, flowId);

    await failBtn(card).click();
    const fb = pane.getByRole("textbox", { name: /^Góp ý cho .+ \(bắt buộc\)$/ });
    await expect(fb).toBeFocused();
    const send = pane.getByRole("button", { name: "Gửi góp ý · làm lại" });
    await expect(send).toBeDisabled();
    await fb.fill("Thiếu MST");
    await rtScript(runId, 0, [{ kind: "hold" }]);
    await send.click();
    const res = taskResult(pane, "Hoa", "Chưa đạt");
    await expect(res).toBeVisible();
    await expect(res).toContainText("Thiếu MST");
    await expect(block(u.A)).toContainText("Đang chạy");
    await rtScript(runId, 0, [{ kind: "done", tag: "v2" }]);
    await expect(outputMsg(pane, "Đọc hoá đơn", 2)).toBeVisible();
    expect(await userMsgsInFlow("A", room.id, flowId)).toBe(userBefore);

    await openThread(u.X, room.id);
    const px = flowPane(u.X);
    await expect(taskResult(px, "Hoa", "Chưa đạt")).toBeVisible();
    await expect(passBtn(px)).toHaveCount(0);
    await expect(failBtn(px)).toHaveCount(0);
    await expect(waitingNote(px, /Đang chờ .* kiểm — chỉ người kiểm mới bấm được\./)).toBeVisible();
  } finally {
    await u.close();
  }
});

test('CHAT-AC-53 · E-P5 · B (thread) và T (ngoài phòng /runs/:id?task=) bấm "Đạt" gần đồng thời ⇒ người sau "Đã có người khác quyết", nút biến mất; thread đúng 1 tin kết quả task', async ({
  browser,
}) => {
  const room = await mkRoom("EP5");
  const u = await users(browser, "A", "B", "T");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    const { runId } = await startUi(u.A, "!hoa-don-t HD-5");
    await rtScript(runId, 1, [{ kind: "hold" }]);
    await openThread(u.B, room.id);
    const card = flowPane(u.B).getByRole("region", { name: "Kiểm Đọc hoá đơn" });
    await expect(card).toBeVisible();
    await u.T.goto(`/runs/${runId}`);
    const tCard = u.T.getByRole("region", { name: "Kiểm Đọc hoá đơn" });
    await expect(tCard).toBeVisible();

    await Promise.all([passBtn(card).click(), passBtn(tCard).click()]);
    const late = u.B.getByText("Đã có người khác quyết").or(
      u.T.getByText("Đã có người khác quyết"),
    );
    await expect(late).toBeVisible();
    await expect(passBtn(card)).toHaveCount(0);
    await expect(passBtn(tCard)).toHaveCount(0);
    await expect(flowPane(u.B).getByRole("article", { name: / · Đạt · /i })).toHaveCount(1);
  } finally {
    await u.close();
  }
});
